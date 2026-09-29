const fs = require('fs');
const path = require('path');

class MySqliteRequest {
  constructor() {
    this._type = null;         // 'select', 'insert', 'update', 'delete'
    this._tableName = null;
    this._columns = '*';
    this._whereClause = null;  // { column, value }
    this._joinClause = null;   // { colA, fileB, colB }
    this._orderClause = null;  // { order, column }
    this._insertData = null;   // hash for insert
    this._updateData = null;   // hash for set
    this._insertTable = null;
    this._updateTable = null;
  }

  // ─── Builder Methods ──────────────────────────────────────────────────────

  from(tableName) {
    const req = this._clone();
    req._tableName = tableName;
    req._type = 'select';
    return req;
  }

  select(columnName) {
    const req = this._clone();
    req._type = 'select';
    req._columns = Array.isArray(columnName) ? columnName : [columnName];
    return req;
  }

  where(columnName, criteria) {
    const req = this._clone();
    req._whereClause = { column: columnName, value: String(criteria) };
    return req;
  }

  join(columnOnDbA, filenameDbB, columnOnDbB) {
    const req = this._clone();
    req._joinClause = { colA: columnOnDbA, fileB: filenameDbB, colB: columnOnDbB };
    return req;
  }

  order(ord, columnName) {
    const req = this._clone();
    req._orderClause = { order: ord, column: columnName };
    return req;
  }

  insert(tableName) {
    const req = this._clone();
    req._type = 'insert';
    req._insertTable = tableName;
    return req;
  }

  values(data) {
    const req = this._clone();
    req._insertData = data;
    return req;
  }

  update(tableName) {
    const req = this._clone();
    req._type = 'update';
    req._updateTable = tableName;
    return req;
  }

  set(data) {
    const req = this._clone();
    req._updateData = data;
    return req;
  }

  delete() {
    const req = this._clone();
    req._type = 'delete';
    return req;
  }

  // ─── Run ─────────────────────────────────────────────────────────────────

  run() {
    switch (this._type) {
      case 'select': return this._runSelect();
      case 'insert': return this._runInsert();
      case 'update': return this._runUpdate();
      case 'delete': return this._runDelete();
      default: throw new Error('No operation type set. Use from(), insert(), update(), or delete().');
    }
  }

  // ─── Internal Helpers ─────────────────────────────────────────────────────

  _clone() {
    const next = new MySqliteRequest();
    Object.assign(next, this);
    return next;
  }

  _loadCSV(filename) {
    const filePath = path.resolve(filename);
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length);
    if (lines.length === 0) return [];
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map((line, idx) => {
      const values = _splitCSVLine(line);
      const row = {};
      headers.forEach((h, i) => { row[h] = (values[i] || '').trim(); });
      if (!row['id']) row['id'] = String(idx + 1);
      return row;
    });
  }

  _saveCSV(filename, rows) {
    if (rows.length === 0) { fs.writeFileSync(filename, '', 'utf8'); return; }
    const headers = Object.keys(rows[0]);
    const lines = [headers.join(',')];
    rows.forEach(row => {
      lines.push(headers.map(h => _escapeCSV(row[h] === undefined ? '' : row[h])).join(','));
    });
    fs.writeFileSync(filename, lines.join('\n') + '\n', 'utf8');
  }

  _applyWhere(rows) {
    if (!this._whereClause) return rows;
    const { column, value } = this._whereClause;
    return rows.filter(row => String(row[column] || '') === value);
  }

  _applySelect(rows) {
    if (this._columns === '*' || !Array.isArray(this._columns)) return rows;
    return rows.map(row => {
      const out = {};
      this._columns.forEach(col => { out[col] = row[col]; });
      return out;
    });
  }

  _applyOrder(rows) {
    if (!this._orderClause) return rows;
    const { order, column } = this._orderClause;
    return [...rows].sort((a, b) => {
      const av = a[column] || '';
      const bv = b[column] || '';
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return (order === 'desc' || order === ':desc' || order === ':description') ? -cmp : cmp;
    });
  }

  _applyJoin(rows) {
    if (!this._joinClause) return rows;
    const { colA, fileB, colB } = this._joinClause;
    const rightRows = this._loadCSV(fileB);
    const result = [];
    rows.forEach(rowA => {
      const matches = rightRows.filter(rowB => String(rowB[colB]) === String(rowA[colA]));
      if (matches.length === 0) {
        result.push({ ...rowA });
      } else {
        matches.forEach(rowB => result.push({ ...rowA, ...rowB }));
      }
    });
    return result;
  }

  _runSelect() {
    let rows = this._loadCSV(this._tableName);
    rows = this._applyJoin(rows);
    rows = this._applyWhere(rows);
    rows = this._applyOrder(rows);
    rows = this._applySelect(rows);
    return rows;
  }

  _runInsert() {
    const filename = this._insertTable || this._tableName;
    let rows = [];
    try { rows = this._loadCSV(filename); } catch (_) {}
    const maxId = rows.reduce((m, r) => Math.max(m, parseInt(r.id) || 0), 0);
    const newRow = { id: String(maxId + 1), ...this._insertData };
    rows.push(newRow);
    this._saveCSV(filename, rows);
    return [newRow];
  }

  _runUpdate() {
    const filename = this._updateTable || this._tableName;
    let rows = this._loadCSV(filename);
    let updated = 0;
    rows = rows.map(row => {
      if (!this._whereClause || String(row[this._whereClause.column]) === this._whereClause.value) {
        updated++;
        return { ...row, ...this._updateData };
      }
      return row;
    });
    this._saveCSV(filename, rows);
    return [{ updated }];
  }

  _runDelete() {
    const filename = this._tableName;
    let rows = this._loadCSV(filename);
    const before = rows.length;
    if (this._whereClause) {
      rows = rows.filter(row => String(row[this._whereClause.column]) !== this._whereClause.value);
    } else {
      rows = [];
    }
    this._saveCSV(filename, rows);
    return [{ deleted: before - rows.length }];
  }
}

// ─── CSV Utilities ───────────────────────────────────────────────────────────

function _splitCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function _escapeCSV(val) {
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

module.exports = MySqliteRequest;
