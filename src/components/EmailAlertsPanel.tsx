import React, { useState } from 'react';
import { Mail, Send, CheckCircle2, AlertCircle, RefreshCw, Bell } from 'lucide-react';
import { EmailSettings } from '../types';

interface EmailAlertsPanelProps {
  settings: EmailSettings;
  onUpdateSettings: (newSettings: Partial<EmailSettings>) => void;
  onSendTestEmail: (recipient: string) => Promise<void>;
  isSendingTest: boolean;
  userTokenAvailable: boolean;
  userEmail?: string;
  onPromptSignIn: () => void;
}

export const EmailAlertsPanel: React.FC<EmailAlertsPanelProps> = ({
  settings,
  onUpdateSettings,
  onSendTestEmail,
  isSendingTest,
  userTokenAvailable,
  userEmail,
  onPromptSignIn,
}) => {
  const [testRecipient, setTestRecipient] = useState(settings.recipientEmail || userEmail || '');
  const [testStatus, setTestStatus] = useState<string | null>(null);

  const handleTestSend = async () => {
    if (!userTokenAvailable) {
      onPromptSignIn();
      return;
    }
    const targetEmail = testRecipient || userEmail || settings.recipientEmail;
    if (!targetEmail) {
      setTestStatus('Please enter a recipient email address');
      return;
    }

    setTestStatus('Sending test email via Gmail...');
    try {
      await onSendTestEmail(targetEmail);
      setTestStatus('Test email sent successfully via Gmail!');
    } catch (err: any) {
      setTestStatus(`Failed to send email: ${err.message || 'Error'}`);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2.5">
          <div className="p-2.5 bg-teal-100 text-teal-800 rounded-xl">
            <Mail className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">Gmail Price Drop Alerts</h3>
            <p className="text-xs text-slate-500">Instant email notifications when prices drop or hit targets</p>
          </div>
        </div>

        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => onUpdateSettings({ enabled: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-600"></div>
        </label>
      </div>

      {!userTokenAvailable ? (
        <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4 text-center space-y-3">
          <p className="text-xs text-slate-600">
            Sign in with Google to enable sending price alert emails via your Gmail account.
          </p>
          <button
            onClick={onPromptSignIn}
            className="inline-flex items-center space-x-2 bg-teal-600 hover:bg-teal-500 text-white font-semibold text-xs px-4 py-2 rounded-xl transition-all cursor-pointer"
          >
            <span>Connect Gmail</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Recipient Email Address</label>
            <div className="flex gap-2">
              <input
                type="email"
                placeholder="you@gmail.com"
                value={testRecipient}
                onChange={(e) => {
                  setTestRecipient(e.target.value);
                  onUpdateSettings({ recipientEmail: e.target.value });
                }}
                className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              />
              <button
                onClick={handleTestSend}
                disabled={isSendingTest || !settings.enabled}
                className="inline-flex items-center space-x-1.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs px-3.5 py-2 rounded-xl shadow-sm transition-all cursor-pointer disabled:opacity-50"
              >
                <Send className={`w-3.5 h-3.5 ${isSendingTest ? 'animate-bounce' : ''}`} />
                <span>{isSendingTest ? 'Sending...' : 'Test Email'}</span>
              </button>
            </div>
            {testStatus && (
              <p className={`text-[11px] mt-1 font-medium ${testStatus.includes('success') ? 'text-emerald-600' : 'text-slate-600'}`}>
                {testStatus}
              </p>
            )}
          </div>

          <div className="pt-2 border-t border-slate-100 space-y-2 text-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
              <div className="flex items-center space-x-2">
                <Bell className="w-4 h-4 text-teal-600" />
                <span className="font-semibold text-slate-800">Email Notification Threshold:</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-slate-600">Price must drop by at least</span>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={settings.minDropPercent ?? 5}
                  onChange={(e) => onUpdateSettings({ minDropPercent: parseFloat(e.target.value) || 5 })}
                  className="w-14 bg-white border border-slate-300 rounded-lg px-2 py-1 text-center font-bold text-teal-800 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                />
                <span className="font-bold text-slate-700">% vs previous day</span>
              </div>
            </div>

            <p className="text-[11px] text-slate-500">
              * Note: The agent tracks all price changes in history & Google Sheets, but dispatches Gmail alerts strictly when the drop reaches or exceeds {settings.minDropPercent ?? 5}%.
            </p>
          </div>

          {settings.lastEmailSent && (
            <p className="text-[10px] text-slate-400 font-mono">
              Last email dispatched: {new Date(settings.lastEmailSent).toLocaleString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
