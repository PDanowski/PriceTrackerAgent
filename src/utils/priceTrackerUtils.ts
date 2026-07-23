import { Product } from '../types';

// Helper to record ONLY the lowest price observed on each calendar day
export const recordDailyLowestPrice = (
  history: Array<{ timestamp: string; price: number }>,
  newPrice: number
): Array<{ timestamp: string; price: number }> => {
  const todayStr = new Date().toISOString().split('T')[0];
  const existingIndex = history.findIndex((item) => item.timestamp.split('T')[0] === todayStr);

  if (existingIndex >= 0) {
    const existing = history[existingIndex];
    if (newPrice < existing.price) {
      // Found a lower price today -> update today's recorded entry to this new minimum
      const updated = [...history];
      updated[existingIndex] = { timestamp: new Date().toISOString(), price: newPrice };
      return updated;
    }
    // Price today is higher or equal to today's recorded lowest price -> keep existing lower record
    return history;
  } else {
    // First price check of the day -> record this initial price for today
    return [...history, { timestamp: new Date().toISOString(), price: newPrice }].slice(-60);
  }
};

export const buildPriceDropEmailHtml = (
  drops: Array<{ title: string; oldPrice: number; newPrice: number; currency: string; url: string }>
): string => {
  const rowsHtml = drops
    .map(
      (d) => `
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 10px; font-weight: bold;"><a href="${d.url}" style="color: #059669; text-decoration: none;">${d.title}</a></td>
      <td style="padding: 10px; color: #64748b; text-decoration: line-through;">${d.currency}${d.oldPrice.toFixed(2)}</td>
      <td style="padding: 10px; color: #059669; font-weight: bold;">${d.currency}${d.newPrice.toFixed(2)}</td>
      <td style="padding: 10px; color: #0d9488; font-weight: bold;">-${((1 - d.newPrice / d.oldPrice) * 100).toFixed(1)}%</td>
    </tr>
  `
    )
    .join('');

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; rounded-radius: 12px; overflow: hidden;">
      <div style="background-color: #0f172a; padding: 20px; text-align: center; color: #ffffff;">
        <h2 style="margin: 0; font-size: 20px;">Price Drop Alert!</h2>
        <p style="margin: 5px 0 0 0; font-size: 13px; color: #94a3b8;">Product Price Tracker Agent Notice</p>
      </div>
      <div style="padding: 20px;">
        <p style="font-size: 14px; color: #334155;">The automated price tracker agent detected price drops on your monitored items:</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; margin-top: 15px;">
          <thead>
            <tr style="background-color: #f8fafc; color: #475569;">
              <th style="padding: 8px;">Product</th>
              <th style="padding: 8px;">Was</th>
              <th style="padding: 8px;">Now</th>
              <th style="padding: 8px;">Save</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
        <p style="font-size: 12px; color: #94a3b8; margin-top: 25px;">Tracked automatically by Product Price Tracker Agent.</p>
      </div>
    </div>
  `;
};
