// Lightweight spaced-repetition scheduler (SM-2-flavored) for the vocabulary deck. Vocabulary is a real
// reading-rate limiter — you slow on words you don't know — so surfacing and drilling rare words you read
// raises sustainable speed. Grades: 0 again · 1 hard · 2 good · 3 easy. Pure (no React / no I/O).

const DAY = 86400000;

export function newCard(word, context, now) {
  return { word, context: context || '', addedAt: now, reps: 0, interval: 0, ease: 2.3, due: now, lastGrade: null };
}

// Return the updated card after grading it at time `now`.
export function schedule(card, grade, now) {
  let { reps, interval, ease } = card;
  ease = Math.max(1.3, Math.round((ease + (grade === 0 ? -0.2 : grade === 1 ? -0.05 : grade === 3 ? 0.1 : 0)) * 100) / 100);
  if (grade === 0) {
    reps = 0; interval = 0; // lapse → relearn shortly
  } else {
    reps += 1;
    if (reps === 1) interval = grade === 1 ? 0.5 : grade === 3 ? 2 : 1;       // days
    else if (reps === 2) interval = grade === 1 ? 2 : grade === 3 ? 5 : 3;
    else interval = Math.max(1, Math.round(interval * ease * (grade === 1 ? 0.7 : grade === 3 ? 1.3 : 1)));
  }
  const due = now + (grade === 0 ? 10 * 60000 : interval * DAY); // relapse due in ~10 min
  return { ...card, reps, interval, ease, due, lastGrade: grade };
}

export function dueCards(deck, now) {
  return (deck || []).filter((c) => (c.due || 0) <= now);
}

// "Learned" = answered correctly enough that the interval is at least a few days.
export function learnedCount(deck) {
  return (deck || []).filter((c) => (c.interval || 0) >= 3).length;
}
