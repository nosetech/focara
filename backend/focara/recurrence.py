"""繰り返しルールに従った次回日付の算出。"""

import calendar
from datetime import date, timedelta

from focara.db.models import Habit


def _clamp_day(year: int, month: int, day: int) -> date:
    """その日がない月は月末に寄せる(月次の -1 は月末)。"""
    last = calendar.monthrange(year, month)[1]
    return date(year, month, last if day == -1 else min(day, last))


def next_occurrence(rule: Habit, after: date) -> date:
    """繰り返しルールに従い、after より後で最初の日付を返す。"""
    if rule.recurrence_type == "weekly":
        mask = rule.recurrence_weekdays
        for i in range(1, 8):
            d = after + timedelta(days=i)
            if mask >> ((d.weekday() + 1) % 7) & 1:  # bit0=日 ... bit6=土
                return d
    elif rule.recurrence_type == "monthly":
        year, month = after.year, after.month
        while True:
            d = _clamp_day(year, month, rule.recurrence_month_day)
            if d > after:
                return d
            year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    elif rule.recurrence_type == "yearly":
        year = after.year
        while True:
            d = _clamp_day(year, rule.recurrence_month, rule.recurrence_day)
            if d > after:
                return d
            year += 1
    raise ValueError("繰り返しが設定されていません")
