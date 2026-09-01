const ExcelJS = require('exceljs');
const { formatDatePtBR } = require('../utils/dates');

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",;\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Builds a UTF-8 (with BOM, for Excel compatibility) CSV string using ';' delimiter (pt-BR locale default). */
function toCSV(rows, columns) {
  const header = columns.map((c) => csvEscape(c.header)).join(';');
  const lines = rows.map((row) => columns.map((c) => csvEscape(c.format ? c.format(row[c.key], row) : row[c.key])).join(';'));
  return '﻿' + [header, ...lines].join('\r\n');
}

async function toXLSXBuffer(rows, columns, sheetName, metadata) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sistema de Gestão de Projetos';
  wb.created = new Date();
  if (metadata) {
    wb.properties = wb.properties || {};
  }
  const sheet = wb.addWorksheet(sheetName.slice(0, 31));

  if (metadata && Object.keys(metadata).length) {
    const metaSheet = wb.addWorksheet('Filtros aplicados');
    metaSheet.columns = [{ header: 'Filtro', key: 'k', width: 28 }, { header: 'Valor', key: 'v', width: 60 }];
    metaSheet.getRow(1).font = { bold: true };
    for (const [k, v] of Object.entries(metadata)) {
      metaSheet.addRow({ k, v: typeof v === 'object' ? JSON.stringify(v) : String(v) });
    }
  }

  sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 22 }));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  for (const row of rows) {
    const values = {};
    for (const c of columns) {
      values[c.key] = c.format ? c.format(row[c.key], row) : row[c.key];
    }
    sheet.addRow(values);
  }
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  return wb.xlsx.writeBuffer();
}

const dateFmt = (v) => formatDatePtBR(v);
const boolFmt = (v) => (v ? 'Sim' : 'Não');
const numFmt = (v) => (v === null || v === undefined ? '' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 }));

module.exports = { toCSV, toXLSXBuffer, dateFmt, boolFmt, numFmt };
