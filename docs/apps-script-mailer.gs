/*
 * ClosedAI Gmail mailer
 *
 * Setup:
 * 1. Open https://script.google.com and create an Apps Script project.
 * 2. Paste this file, then deploy as Web app (Execute as: Me, access: Anyone).
 * 3. In Project Settings > Script properties, add MAIL_SECRET. Set the same
 *    value on Render as APPS_SCRIPT_SECRET.
 * 4. Set ClosedAI MAIL_PROVIDER=apps_script and APPS_SCRIPT_URL to the Web app URL.
 * 5. Approve Gmail authorization when Google prompts during deployment/testing.
 * 6. After changing this script, publish a new version under Deploy > Manage deployments.
 */

function jsonResponse(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var expectedSecret = PropertiesService.getScriptProperties().getProperty('MAIL_SECRET') || '';
    if (!expectedSecret || payload.secret !== expectedSecret) {
      return jsonResponse({ok: false, error: 'unauthorized'});
    }

    var recipient = String(payload.to || '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) {
      return jsonResponse({ok: false, error: 'invalid recipient'});
    }

    var subject = String(payload.subject || '').slice(0, 200);
    var text = String(payload.text || '').slice(0, 20000);
    var html = String(payload.html || '').slice(0, 20000);
    if (MailApp.getRemainingDailyQuota() < 1) {
      return jsonResponse({ok: false, error: 'quota exhausted'});
    }

    subject = subject.replace(/[\r\n]/g, '');
    var name = String(payload.name || 'ClosedAI').slice(0, 200).replace(/[\r\n]/g, '');
    var replyTo = String(payload.replyTo || '').slice(0, 320).replace(/[\r\n]/g, '');
    var options = {
      name: name
    };
    if (html) options.htmlBody = html;
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(replyTo)) options.replyTo = replyTo;
    MailApp.sendEmail(recipient, subject, text, options);
    return jsonResponse({ok: true, remaining: MailApp.getRemainingDailyQuota()});
  } catch (error) {
    console.error(error && error.message ? String(error.message) : 'mail send failed');
    return jsonResponse({ok: false, error: 'mail send failed'});
  }
}
