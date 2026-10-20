// Normalização e validação dos valores dos cadastros de logística.
//
// Regra geral (a mesma do importador original): limpar só o que é ruído de
// digitação (espaços duplicados, espaço não separável, tabulação) e
// SINALIZAR o resto — CNPJ com dígito verificador inválido, UF desconhecida,
// CEP numérico — sem corrigir em silêncio.

const PLACEHOLDERS = new Set(['na', 'n/a', 'n.a', 'n.a.', '-', '--', '—', 'nao tem', 'não tem', 'nt', 'x']);

const UFS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

/** Trims and collapses whitespace (incl. NBSP and tabs). Returns null for empty. */
function cleanText(value) {
  if (value === null || value === undefined) return null;
  let str;
  if (typeof value === 'number') {
    str = Number.isInteger(value) ? String(value) : String(value);
  } else if (value instanceof Date) {
    str = value.toISOString().slice(0, 10);
  } else if (typeof value === 'object') {
    // exceljs rich text / hyperlink / formula result cells
    if (Array.isArray(value.richText)) str = value.richText.map((r) => r.text).join('');
    else if (value.text !== undefined) str = String(value.text);
    else if (value.result !== undefined) return cleanText(value.result);
    else str = String(value);
  } else {
    str = String(value);
  }
  str = str.replace(/[   \t\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return str === '' ? null : str;
}

function isPlaceholder(str) {
  if (str === null || str === undefined) return false;
  return PLACEHOLDERS.has(String(str).trim().toLowerCase());
}

/** Lowercase, accent-free, single-spaced key used for duplicate detection. */
function normalizeKey(value) {
  const str = cleanText(value);
  if (!str) return '';
  return str
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalized header used to auto-map spreadsheet columns (letters/digits only). */
function headerKey(value) {
  return normalizeKey(value).replace(/[^a-z0-9]+/g, '');
}

function digitsOnly(value) {
  const str = cleanText(value);
  return str ? str.replace(/\D+/g, '') : '';
}

/** Validates the two CNPJ check digits. */
function isValidCnpj(digits) {
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return false;
  const calc = (len) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + Number(digits[i]) * w, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return calc(12) === Number(digits[12]) && calc(13) === Number(digits[13]);
}

function formatCnpj(digits) {
  if (!/^\d{14}$/.test(digits)) return null;
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

/**
 * Normalizes a CEP. A CEP that came as a number (Excel drops the leading
 * zero, e.g. 5322900 -> 05322-900) is padded back to 8 digits and flagged.
 * Returns { value, warning }.
 */
function normalizeZip(raw) {
  const str = cleanText(raw);
  if (!str) return { value: null, warning: null };
  const asNumber = typeof raw === 'number' || /^\d+(\.0+)?$/.test(str);
  let digits = str.replace(/\.0+$/, '').replace(/\D+/g, '');
  if (asNumber && digits.length === 7) {
    digits = `0${digits}`;
    return { value: `${digits.slice(0, 5)}-${digits.slice(5)}`, warning: `CEP "${str}" veio como número; zero à esquerda restaurado.` };
  }
  if (digits.length === 8) return { value: `${digits.slice(0, 5)}-${digits.slice(5)}`, warning: null };
  return { value: str, warning: `CEP "${str}" não tem 8 dígitos.` };
}

function isValidEmail(str) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
}

const regionKey = (name) => normalizeKey(name);

/** Duplicate key of a branch: CNPJ + branch code; falls back to the name when there is no CNPJ. */
function branchKey({ cnpjDigits, branchCode, branchName, regionName }) {
  const code = normalizeKey(branchCode);
  if (cnpjDigits) return `cnpj:${cnpjDigits}|filial:${code}`;
  return `regiao:${regionKey(regionName)}|nome:${normalizeKey(branchName)}|filial:${code}`;
}

/** Duplicate key of a carrier row: the unit it serves + the carrier name. */
function carrierKey({ cnpjDigits, branchCode, branchName, regionName, carrierName }) {
  return `${branchKey({ cnpjDigits, branchCode, branchName, regionName })}|transp:${normalizeKey(carrierName)}`;
}

const contactKey = (regionName, department) => `regiao:${regionKey(regionName)}|depto:${normalizeKey(department)}`;

module.exports = {
  UFS,
  cleanText,
  isPlaceholder,
  normalizeKey,
  headerKey,
  digitsOnly,
  isValidCnpj,
  formatCnpj,
  normalizeZip,
  isValidEmail,
  regionKey,
  branchKey,
  carrierKey,
  contactKey,
};
