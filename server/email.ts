import { Router } from 'express';

export const emailRouter = Router();

// Gmail: Send Price Alert Notification Email
emailRouter.post('/send', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : req.body.accessToken;
    const { recipientEmail, subject, htmlBody } = req.body;

    if (!token) {
      return res.status(401).json({ error: 'Google Access Token is required' });
    }
    if (!recipientEmail) {
      return res.status(400).json({ error: 'Recipient email is required' });
    }

    const encodeMimeHeader = (text: string) => {
      if (/[^\x00-\x7F]/.test(text)) {
        return `=?UTF-8?B?${Buffer.from(text, 'utf-8').toString('base64')}?=`;
      }
      return text;
    };

    const cleanSubject = subject || 'Powiadomienie o obniżce ceny';

    const rawMessage = [
      `To: ${recipientEmail}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      `Subject: ${encodeMimeHeader(cleanSubject)}`,
      '',
      htmlBody || '<p>Product price update notification.</p>',
    ].join('\r\n');

    const encodedMessage = Buffer.from(rawMessage, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encodedMessage }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `Gmail API error: ${errText}` });
    }

    const data = await response.json();
    return res.json({
      success: true,
      messageId: data.id,
      sentTo: recipientEmail,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error in /api/email/send:', error);
    return res.status(500).json({ error: error.message || 'Failed to send email' });
  }
});
