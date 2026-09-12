import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeStreak, sessionsCompletedCount } from '../js/stats.js';
import { localDateStr } from '../js/store.js';

// Mon/Wed/Fri lifting, matches the seed's default schedule.
const program = {
  schedule: { mon: 'FBA', tue: 'cardio_or_basketball', wed: 'FBB', thu: 'cardio_or_basketball', fri: 'FBC', sat: 'cardio_or_basketball', sun: 'rest' },
  sessions: [{ id: 'FBA' }, { id: 'FBB' }, { id: 'FBC' }],
};

function history(dates) {
  return dates.map(date => ({ date }));
}

describe('sessionsCompletedCount', () => {
  test('is just the history length -- one source of truth (audit #7)', () => {
    assert.equal(sessionsCompletedCount([]), 0);
    assert.equal(sessionsCompletedCount([{ date: '2026-09-14' }, { date: '2026-09-16' }]), 2);
  });
});

describe('computeStreak (audit #6: must not break on scheduled rest days)', () => {
  test('a rest/cardio day between two completed lift days does not break the streak', () => {
    // Mon 9/14 (FBA, done), Tue (cardio, not logged -- fine), Wed 9/16 (FBB, done).
    // "Today" is Wed 9/16, already completed.
    const today = new Date(2026, 8, 16); // Wed
    const h = history(['2026-09-14', '2026-09-16']);
    assert.equal(computeStreak(program, h, today), 2);
  });

  test('a missed scheduled lifting day breaks the streak', () => {
    // Mon done, Wed MISSED, Fri done. Today = Fri, evaluating backward should
    // stop at the missed Wednesday, giving a streak of 1 (just Friday).
    const today = new Date(2026, 8, 18); // Fri
    const h = history(['2026-09-14', '2026-09-18']); // no 2026-09-16
    assert.equal(computeStreak(program, h, today), 1);
  });

  test('today not yet logged does not break the streak (the day is not over)', () => {
    // Mon done, Wed done, today is Fri and hasn't been logged yet.
    const today = new Date(2026, 8, 18); // Fri, not logged
    const h = history(['2026-09-14', '2026-09-16']);
    assert.equal(computeStreak(program, h, today), 2);
  });

  test('zero history is a zero streak, not an infinite loop', () => {
    const today = new Date(2026, 8, 18);
    assert.equal(computeStreak(program, [], today), 0);
  });

  test('a full 3-week unbroken run counts every scheduled lift day', () => {
    const dates = [];
    for (const [d] of [['2026-09-14'], ['2026-09-16'], ['2026-09-18'], ['2026-09-21'], ['2026-09-23'], ['2026-09-25']]) dates.push(d);
    const today = new Date(2026, 8, 25); // Fri of week 2, already logged
    assert.equal(computeStreak(program, history(dates), today), 6);
  });

  test('localDateStr is used consistently (no UTC off-by-one)', () => {
    // Late-evening local time must still match the date the session was logged under.
    const lateEvening = new Date(2026, 8, 16, 23, 30);
    assert.equal(localDateStr(lateEvening), '2026-09-16');
  });
});
