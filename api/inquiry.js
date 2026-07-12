// api/inquiry.js
// Vercel Serverless Function to process Bulk Inquiry submissions

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: `Method ${req.method} Not Allowed` });
  }

  try {
    const {
      orgName,
      orgType,
      quantity,
      printerModel,
      timeline,
      contactName,
      contactPhone,
      contactEmail,
      message
    } = req.body || {};

    // 1. Validation
    const requiredFields = {
      orgName: 'Organisation name',
      orgType: 'Organisation type',
      quantity: 'Estimated quantity',
      printerModel: 'Printer model',
      timeline: 'Deployment timeline',
      contactName: 'Contact name',
      contactPhone: 'Phone number',
      contactEmail: 'Email address'
    };

    for (const [key, label] of Object.entries(requiredFields)) {
      const val = req.body?.[key];
      if (!val || typeof val !== 'string' || val.trim() === '') {
        return res.status(400).json({ success: false, error: `${label} is required` });
      }
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      return res.status(400).json({ success: false, error: 'A valid contact email address is required' });
    }

    // 2. Supabase Integration
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error('Missing Supabase Environment Variables');
      return res.status(500).json({
        success: false,
        error: 'Database configuration missing. Please ensure SUPABASE_URL and SUPABASE_ANON_KEY are set.'
      });
    }

    // Map payload keys to database columns
    const payload = {
      org_name: orgName.trim(),
      org_type: orgType.trim(),
      quantity: quantity.trim(),
      printer_model: printerModel.trim(),
      timeline: timeline.trim(),
      contact_name: contactName.trim(),
      contact_phone: contactPhone.trim(),
      contact_email: contactEmail.trim().toLowerCase(),
      message: message ? message.trim() : null
    };

    const supabaseResponse = await fetch(`${supabaseUrl}/rest/v1/inquiries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(payload)
    });

    if (!supabaseResponse.ok) {
      const errorText = await supabaseResponse.text();
      console.error('Supabase error:', errorText);
      try {
        const errorJson = JSON.parse(errorText);
        return res.status(supabaseResponse.status).json({
          success: false,
          error: errorJson.message || errorJson.hint || `Database returned status ${supabaseResponse.status}`
        });
      } catch {
        return res.status(supabaseResponse.status).json({
          success: false,
          error: `Database error: ${errorText}`
        });
      }
    }

    const insertedData = await supabaseResponse.json();

    // 3. Resend Email Notification
    const resendApiKey = process.env.RESEND_API_KEY;
    if (resendApiKey) {
      try {
        const htmlContent = `
          <h2>New Bulk Inquiry</h2>
          <p><strong>Organisation Name:</strong> ${payload.org_name}</p>
          <p><strong>Organisation Type:</strong> ${payload.org_type}</p>
          <p><strong>Estimated Quantity:</strong> ${payload.quantity}</p>
          <p><strong>Printer Model of Interest:</strong> ${payload.printer_model}</p>
          <p><strong>Deployment Timeline:</strong> ${payload.timeline}</p>
          <hr />
          <p><strong>Contact Person:</strong> ${payload.contact_name}</p>
          <p><strong>Phone:</strong> ${payload.contact_phone}</p>
          <p><strong>Email:</strong> <a href="mailto:${payload.contact_email}">${payload.contact_email}</a></p>
          <hr />
          <p><strong>Additional Requirements:</strong></p>
          <p style="white-space: pre-wrap; background: #f5f5f5; padding: 12px; border-radius: 4px;">${payload.message || '—'}</p>
        `;

        const emailResponse = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resendApiKey}`
          },
          body: JSON.stringify({
            from: 'Sourcezy Web Forms <onboarding@resend.dev>',
            to: ['sales@sourcezy.in'],
            subject: `New Bulk Inquiry — ${payload.org_name} (${payload.quantity})`,
            html: htmlContent
          })
        });

        if (!emailResponse.ok) {
          const resendError = await emailResponse.text();
          console.error('Resend error:', resendError);
        }
      } catch (err) {
        console.error('Failed to send email via Resend:', err);
      }
    }

    // 4. Optional: Notification Webhook
    const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        const textContent = `🏢 🚀 **New Bulk Inquiry on Sourcezy**\n` +
          `• **Organisation**: ${payload.org_name} (${payload.org_type})\n` +
          `• **Quantity**: ${payload.quantity}\n` +
          `• **Printer Model**: ${payload.printer_model}\n` +
          `• **Timeline**: ${payload.timeline}\n` +
          `• **Contact Person**: ${payload.contact_name}\n` +
          `• **Phone**: ${payload.contact_phone}\n` +
          `• **Email**: ${payload.contact_email}\n` +
          `• **Message**: ${payload.message || 'None'}`;

        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: textContent })
        });
      } catch (err) {
        console.error('Failed to send notification webhook:', err);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Thank you! Your inquiry has been submitted. Our team will contact you shortly.',
      data: insertedData[0] || null
    });

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({
      success: false,
      error: 'An internal server error occurred while processing your inquiry.'
    });
  }
}
