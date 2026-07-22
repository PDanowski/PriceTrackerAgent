/**
 * Helper to calculate seconds remaining until 12:00 PM (Noon) CET / CEST.
 */
export function getSecondsUntilNextNoonCET(): number {
  const now = new Date();
  
  // Format current time in Europe/Paris or Europe/Berlin timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  let hour = 0;
  let minute = 0;
  let second = 0;

  for (const p of parts) {
    if (p.type === 'hour') hour = parseInt(p.value, 10);
    if (p.type === 'minute') minute = parseInt(p.value, 10);
    if (p.type === 'second') second = parseInt(p.value, 10);
  }

  // Target is 12:00:00 CET today
  let secondsRemaining = (12 - hour) * 3600 - minute * 60 - second;

  if (secondsRemaining <= 0) {
    // If past 12:00 PM CET today, target is tomorrow 12:00 PM CET (+24 hours)
    secondsRemaining += 86400;
  }

  return secondsRemaining;
}
