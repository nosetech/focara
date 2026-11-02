from datetime import date

from focara.db.models import Habit
from focara.recurrence import next_occurrence

MON, WED, SUN = 1 << 1, 1 << 3, 1 << 0


def _next(d: date, **rule) -> date:
    return next_occurrence(Habit(**rule), d)


def test_weekly_next_weekday():
    # 2026-10-19 は月曜
    assert _next(date(2026, 10, 19), recurrence_type="weekly", recurrence_weekdays=MON | WED) == (
        date(2026, 10, 21)
    )
    # 同じ曜日のみなら翌週
    assert _next(date(2026, 10, 19), recurrence_type="weekly", recurrence_weekdays=MON) == (
        date(2026, 10, 26)
    )
    # 日曜(bit0)
    assert _next(date(2026, 10, 19), recurrence_type="weekly", recurrence_weekdays=SUN) == (
        date(2026, 10, 25)
    )
    # 毎日(全曜日)
    assert _next(date(2026, 10, 19), recurrence_type="weekly", recurrence_weekdays=127) == (
        date(2026, 10, 20)
    )


def test_monthly_boundaries():
    rule = {"recurrence_type": "monthly"}
    assert _next(date(2026, 1, 31), **rule, recurrence_month_day=31) == date(2026, 2, 28)
    assert _next(date(2026, 2, 28), **rule, recurrence_month_day=31) == date(2026, 3, 31)
    assert _next(date(2028, 1, 31), **rule, recurrence_month_day=30) == date(2028, 2, 29)
    assert _next(date(2026, 1, 15), **rule, recurrence_month_day=-1) == date(2026, 1, 31)
    assert _next(date(2026, 1, 31), **rule, recurrence_month_day=-1) == date(2026, 2, 28)
    assert _next(date(2026, 12, 20), **rule, recurrence_month_day=10) == date(2027, 1, 10)


def test_yearly_leap_day():
    rule = {"recurrence_type": "yearly", "recurrence_month": 2, "recurrence_day": 29}
    assert _next(date(2027, 3, 1), **rule) == date(2028, 2, 29)
    assert _next(date(2027, 1, 1), **rule) == date(2027, 2, 28)
