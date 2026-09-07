// The eight checks `Validate` knows by name (design 138).
//
// Each is given the cell, not what it holds, because four of them write a formatted value back.
// Each answers `''` for an empty value, so a field is not invalid before anybody has typed in it.
//
// They are small on purpose. Measured across five applications, no page names one: all twenty-nine
// uses pass a function of their own. Each does what its name promises and no more.
//
// This is not exported.

/** What a check is given: the cell holding what was typed. */
export interface Checked {
	get(): unknown;
	set(value: unknown): void;
}

/** What a check answers: the problem, or nothing. */
export type Validator = (value: Checked) => string;

const text = (cell: Checked): string => {
	const held = cell.get();
	return held === null || held === undefined ? '' : String(held);
};

const digitsOf = (value: string): string => value.replace(/\D+/g, '');

const phone: Validator = (cell) => {
	const raw = text(cell);
	if (raw.trim() === '') return '';
	const digits = digitsOf(raw);
	const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
	if (national.length !== 10) return 'that is not a ten digit phone number';
	const grouped = `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
	const formatted = digits.length === 11 ? `+1 ${grouped}` : grouped;
	if (formatted !== raw) cell.set(formatted);
	return '';
};

const email: Validator = (cell) => {
	const raw = text(cell).trim();
	if (raw === '') return '';
	// One `@`, something on each side of it, and a dot in the domain. Deliverability is a question
	// only a message can answer, and pretending otherwise is how a valid address gets refused.
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? '' : 'that does not look like an email address';
};

/** The Luhn check digit, which is what says a card number was typed correctly. */
const luhn = (digits: string): boolean => {
	let sum = 0;
	let double = false;
	for (let at = digits.length - 1; at >= 0; at -= 1) {
		let value = Number(digits[at]);
		if (double) {
			value *= 2;
			if (value > 9) value -= 9;
		}
		sum += value;
		double = !double;
	}
	return sum % 10 === 0;
};

const pan: Validator = (cell) => {
	const raw = text(cell);
	if (raw.trim() === '') return '';
	const digits = digitsOf(raw);
	if (digits.length < 13 || digits.length > 19) return 'a card number is thirteen to nineteen digits';
	if (!luhn(digits)) return 'that card number has a digit wrong';
	const grouped = (digits.match(/.{1,4}/g) ?? []).join(' ');
	if (grouped !== raw) cell.set(grouped);
	return '';
};

const expDate: Validator = (cell) => {
	const raw = text(cell);
	if (raw.trim() === '') return '';
	const digits = digitsOf(raw);
	if (digits.length !== 4) return 'an expiry date is MM/YY';
	const month = Number(digits.slice(0, 2));
	if (month < 1 || month > 12) return `there is no month ${digits.slice(0, 2)}`;
	const formatted = `${digits.slice(0, 2)}/${digits.slice(2)}`;
	if (formatted !== raw) cell.set(formatted);
	return '';
};

const postalCode: Validator = (cell) => {
	const raw = text(cell);
	if (raw.trim() === '') return '';
	const packed = raw.replace(/\s+/g, '').toUpperCase();
	if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(packed)) return 'that is not a postal code';
	const formatted = `${packed.slice(0, 3)} ${packed.slice(3)}`;
	if (formatted !== raw) cell.set(formatted);
	return '';
};

const date: Validator = (cell) => {
	const raw = text(cell).trim();
	if (raw === '') return '';
	const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
	if (parts === null) return 'a date is YYYY-MM-DD';
	const [, year, month, day] = parts;
	const made = new Date(`${year!}-${month!}-${day!}T00:00:00Z`);
	// Round tripped rather than range checked, so the thirtieth of February is caught by the
	// calendar rather than by a table of month lengths written here.
	if (Number.isNaN(made.getTime()) || made.toISOString().slice(0, 10) !== raw) return `there is no ${raw}`;
	return '';
};

const number: Validator = (cell) => {
	const raw = text(cell).trim();
	if (raw === '') return '';
	return /^[+-]?\d+$/.test(raw) ? '' : 'that is not a whole number';
};

const float: Validator = (cell) => {
	const raw = text(cell).trim();
	if (raw === '') return '';
	const held = Number(raw);
	return Number.isFinite(held) ? '' : 'that is not a number';
};

/** The eight, by the name `Validate` takes. */
export const VALIDATORS: Readonly<Record<string, Validator>> = {
	phone, email, pan, expDate, postalCode, date, number, float,
};

/** The four that write a formatted value back into the cell. Named for the README and the tests. */
export const FORMATTING: readonly string[] = ['phone', 'pan', 'expDate', 'postalCode'];
