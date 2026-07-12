// api/contact.js
// Vercel Serverless Function to process Contact Form submissions

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { name, organisation, email, phone, message } = req.body || {};

    // 1. Validation
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ success: false, error: 'Name is required' });
    }
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'A valid email address is required' });
    }
    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({ success: false, error: 'Message is required' });
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

    // Clean inputs
    const payload = {
      name: name.trim(),
      organisation: organisation ? organisation.trim() : null,
      email: email.trim().toLowerCase(),
      phone: phone ? phone.trim() : null,
      message: message.trim()
    };

    const supabaseResponse = await fetch(`${supabaseUrl}/rest/v1/contacts`, {
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
          <h2>New Contact Inquiry</h2>
          <p><strong>Name:</strong> ${payload.name}</p>
          <p><strong>Organisation:</strong> ${payload.organisation || 'N/A'}</p>
          <p><strong>Email:</strong> <a href="mailto:${payload.email}">${payload.email}</a></p>
          <p><strong>Phone:</strong> ${payload.phone || 'N/A'}</p>
          <p><strong>Message:</strong></p>
          <p style="white-space: pre-wrap; background: #f5f5f5; padding: 12px; border-radius: 4px;">${payload.message}</p>
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
            subject: `New Contact Form Inquiry — ${payload.name}`,
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
        const textContent = `📬 **New Contact Form Submission on Sourcezy**\n` +
          `• **Name**: ${payload.name}\n` +
          `• **Organisation**: ${payload.organisation || 'N/A'}\n` +
          `• **Email**: ${payload.email}\n` +
          `• **Phone**: ${payload.phone || 'N/A'}\n` +
          `• **Message**: ${payload.message}`;

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
      message: 'Thank you! Your message has been received.',
      data: insertedData[0] || null
    });

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'An internal server error occurred while processing your request.' 
    });
  }
}
