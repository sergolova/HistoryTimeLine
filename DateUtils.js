class DateUtils {
    static createUtcDateWithYear(year, monthIndex, day) {
        const dt = new Date(Date.UTC(0, monthIndex, day));
        dt.setUTCFullYear(year);
        return dt;
    }

    static normalizeFlexibleDate(value) {
        const raw = String(value || '').trim();
        const match = raw.match(/^(\d{1,4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
        if (!match) return '';

        const year = Number(match[1]);
        const month = match[2] ? Number(match[2]) : null;
        const day = match[3] ? Number(match[3]) : null;

        if ((day && !month) || (month && (month < 1 || month > 12)) || (day && (day < 1 || day > 31))) {
            return '';
        }

        if (day && month) {
            const dt = this.createUtcDateWithYear(year, month - 1, day);
            if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
                return '';
            }
        }

        if (!month) return `${year}`;
        const mm = String(month).padStart(2, '0');
        if (!day) return `${year}-${mm}`;
        const dd = String(day).padStart(2, '0');
        return `${year}-${mm}-${dd}`;
    }

    static compareDateStrings(a, b) {
        const parse = (val) => {
            const norm = this.normalizeFlexibleDate(val);
            if (!norm) return Number.NaN;
            const dt = this.toVisDate(norm, false);
            return dt instanceof Date ? dt.getTime() : Number.NaN;
        };
        const aTs = parse(a);
        const bTs = parse(b);
        if (Number.isNaN(aTs) || Number.isNaN(bTs)) return 0;
        return aTs === bTs ? 0 : aTs > bTs ? 1 : -1;
    }

    static toVisDate(value, isEnd) {
        const raw = String(value || '').trim();
        const match = raw.match(/^(\d{1,4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
        if (!match) return raw;

        const year = Number(match[1]);
        const month = match[2] ? Number(match[2]) : null;
        const day = match[3] ? Number(match[3]) : null;

        if (!month) {
            return isEnd ? this.createUtcDateWithYear(year, 11, 31) : this.createUtcDateWithYear(year, 0, 1);
        }
        if (!day) {
            const lastDay = this.createUtcDateWithYear(year, month, 0).getUTCDate();
            return isEnd ? this.createUtcDateWithYear(year, month - 1, lastDay) : this.createUtcDateWithYear(year, month - 1, 1);
        }
        return this.createUtcDateWithYear(year, month - 1, day);
    }

    static formatDateValue(value, options = {}) {
        const raw = String(value || '').trim();
        if (!raw) return '';
        const match = raw.match(/^(\d{1,4})(?:-(\d{2}))?(?:-(\d{2}))?/);
        if (!match) return raw;

        const yearName = options?.yearName !== false ? ' г.' : '';
        const year = Number(match[1]);
        const month = match[2] ? Number(match[2]) : null;
        const day = match[3] ? Number(match[3]) : null;

        if (!month) return `${year}${yearName}`;

        let monthName = new Intl.DateTimeFormat('ru-RU', { month: 'short' })
            .format(this.createUtcDateWithYear(year, month - 1, 1));
        monthName = monthName.charAt(0).toUpperCase() + monthName.slice(1).replace('.', '');

        if (!day) {
            monthName = options?.dayMonth !== false ? `${monthName} ` : '';
            return `${monthName}${year}${yearName}`;
        }

        let dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
            .format(this.createUtcDateWithYear(year, month - 1, day)).replace('.', '');
        dayMonth = options?.dayMonth !== false ? `${dayMonth} ` : '';

        return `${dayMonth}${year}${yearName}`;
    }

    static formatDateRange(item, options = {}) {
        const startLabel = this.formatDateValue(item.start, options);
        const endLabel = this.formatDateValue(item.end, options);

        if (startLabel && endLabel) {
            const dur = this.computeDurationString(item);
            return dur ? `${startLabel} - ${endLabel} (${dur})` : `${startLabel} - ${endLabel}`;
        }
        return startLabel || 'дата не указана';
    }

    static computeDurationString(item) {
        if (!item || !item.start || !item.end) return '';
        const startDate = this.toVisDate(item.start, false);
        const endDate = this.toVisDate(item.end, true);

        if (!(startDate instanceof Date) || !(endDate instanceof Date)) return '';
        if (endDate.getTime() < startDate.getTime()) return '';

        let months = (endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 + (endDate.getUTCMonth() - startDate.getUTCMonth());
        if (endDate.getUTCDate() < startDate.getUTCDate()) months -= 1;
        if (months < 0) months = 0;

        const years = Math.floor(months / 12);
        if (years >= 1) return `${years} ${this.pluralizeYear(years)}`;
        if (months <= 0) return 'менее месяца';
        return `${months} ${this.pluralizeMonth(months)}`;
    }

    static pluralizeYear(n, short = false) {
        n = Math.abs(n) % 100;
        const n1 = n % 10;
        let res = (n > 10 && n < 20) ? 'лет' : (n1 > 1 && n1 < 5) ? 'года' : (n1 === 1) ? 'год' : 'лет';
        return short ? res.slice(0, 1) : res;
    }

    static pluralizeMonth(n, short = false) {
        if (short) return 'м';
        n = Math.abs(n) % 100;
        const n1 = n % 10;
        if (n > 10 && n < 20) return 'месяцев';
        if (n1 > 1 && n1 < 5) return 'месяца';
        return n1 === 1 ? 'месяц' : 'месяцев';
    }

    static formatDateFromDate(date) {
        return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
    }

    static getYearFromDateString(value) {
        const match = String(value || '').trim().match(/^(\d{1,4})/);
        return match ? Number(match[1]) : Number.NaN;
    }
}