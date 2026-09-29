#!/usr/bin/env node
'use strict';

const readline = require('readline');
const MySqliteRequest = require('./my_sqlite_request');

// ─── CLI Entry Point ──────────────────────────────────────────────────────────

console.log('MySQLite version 0.1 2026-06-08');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'my_sqlite_cli> ',
});

rl.prompt();

rl.on('line', (line) => {
  const input = line.trim();
  if (!input) { rl.prompt(); return; }
  if (input.toLowerCase() === 'quit' || input.toLowerCase() === 'exit') {
    rl.close();
    return;
  }

  try {
    const result = parseAndRun(input);
    if (Array.isArray(result)) {
      result.forEach(row => {
        if (typeof row === 'object' && row !== null) {
          // Skip internal mutation-reporting rows like {deleted:N} or {updated:N}
          const keys = Object.keys(row);
          if (keys.length === 1 && (keys[0] === 'deleted' || keys[0] === 'updated')) return;
          console.log(Object.values(row).join('|'));
        } else {
          console.log(row);
        }
      });
    }
  } catch (err) {
    console.error('Error:', err.message);
  }

  rl.prompt();
});

rl.on('close', () => {
  process.exit(0);
});

// ─── SQL Parser ───────────────────────────────────────────────────────────────

function parseAndRun(sql) {
  // Remove trailing semicolon
  sql = sql.replace(/;\s*$/, '').trim();
  const upper = sql.toUpperCase();

  if (upper.startsWith('SELECT')) return parseSelect(sql);
  if (upper.startsWith('INSERT')) return parseInsert(sql);
  if (upper.startsWith('UPDATE')) return parseUpdate(sql);
  if (upper.startsWith('DELETE')) return parseDelete(sql);

  throw new Error(`Unknown SQL command: ${sql}`);
}

// ─── SELECT ──────────────────────────────────────────────────────────────────
// SELECT col1, col2 FROM table [JOIN other ON a = b] [WHERE col = val] [ORDER BY col ASC|DESC]

function parseSelect(sql) {
  // Tokenise using a regex that respects quoted strings
  const tokens = tokenise(sql);
  let req = new MySqliteRequest();

  const upperTokens = tokens.map(t => t.toUpperCase());

  // SELECT columns
  const fromIdx = upperTokens.indexOf('FROM');
  if (fromIdx === -1) throw new Error('SELECT requires FROM');
  const colPart = tokens.slice(1, fromIdx).join(' ');
  const cols = colPart === '*' ? '*' : colPart.split(',').map(c => c.trim());

  // FROM table
  const tableName = tokens[fromIdx + 1];
  req = req.from(tableName);
  if (cols !== '*') req = req.select(cols);

  let i = fromIdx + 2;

  // Optional clauses
  while (i < tokens.length) {
    const kw = upperTokens[i];

    if (kw === 'JOIN') {
      // JOIN filename ON colA = colB
      const fileB = tokens[i + 1];
      if (upperTokens[i + 2] !== 'ON') throw new Error('JOIN requires ON');
      const colA = tokens[i + 3];
      // tokens[i+4] should be '='
      const colB = tokens[i + 5];
      req = req.join(colA, fileB, colB);
      i += 6;
    } else if (kw === 'WHERE') {
      const colName = tokens[i + 1];
      // tokens[i+2] should be '='
      const value = stripQuotes(tokens[i + 3]);
      req = req.where(colName, value);
      i += 4;
    } else if (kw === 'ORDER') {
      if (upperTokens[i + 1] !== 'BY') throw new Error('Expected ORDER BY');
      const colName = tokens[i + 2];
      const ord = (upperTokens[i + 3] || 'ASC').toLowerCase();
      req = req.order(ord, colName);
      i += 4;
    } else {
      i++;
    }
  }

  return req.run();
}

// ─── INSERT ──────────────────────────────────────────────────────────────────
// INSERT INTO table VALUES (v1, v2, ...)  OR  INSERT INTO table (c1,c2) VALUES (v1,v2)

function parseInsert(sql) {
  // Extract table name
  const intoMatch = sql.match(/INSERT\s+INTO\s+(\S+)/i);
  if (!intoMatch) throw new Error('INSERT syntax error: missing INTO');
  const tableName = intoMatch[1];

  // Try column-list style: INSERT INTO t (c1,c2,...) VALUES (v1,v2,...)
  const colValMatch = sql.match(/\(([^)]+)\)\s+VALUES\s+\(([^)]+)\)/i);
  if (colValMatch) {
    const cols = colValMatch[1].split(',').map(c => stripQuotes(c.trim()));
    const vals = splitValues(colValMatch[2]);
    const data = {};
    cols.forEach((c, idx) => { data[c] = vals[idx] || ''; });
    return new MySqliteRequest().insert(tableName).values(data).run();
  }

  // Plain VALUES style: INSERT INTO t VALUES (v1, v2, ...)
  const valMatch = sql.match(/VALUES\s+\(([^)]+)\)/i);
  if (!valMatch) throw new Error('INSERT syntax error: missing VALUES');
  const vals = splitValues(valMatch[1]);

  // We need column names — load first row of CSV to get headers
  const { execSync } = require('child_process');
  let headers;
  try {
    const firstLine = require('fs').readFileSync(tableName, 'utf8').split('\n')[0];
    headers = firstLine.split(',').map(h => h.trim());
  } catch (_) {
    // Fallback: just use positional keys
    headers = vals.map((_, i) => `col${i}`);
  }

  const data = {};
  headers.forEach((h, i) => { if (vals[i] !== undefined) data[h] = vals[i]; });
  return new MySqliteRequest().insert(tableName).values(data).run();
}

// ─── UPDATE ──────────────────────────────────────────────────────────────────
// UPDATE table SET col=val, col2=val2 [WHERE col = val]

function parseUpdate(sql) {
  const tableMatch = sql.match(/UPDATE\s+(\S+)\s+SET\s+/i);
  if (!tableMatch) throw new Error('UPDATE syntax error');
  const tableName = tableMatch[1];

  let setPart = sql.replace(/UPDATE\s+\S+\s+SET\s+/i, '');
  let whereData = null;

  const whereIdx = setPart.search(/\bWHERE\b/i);
  if (whereIdx !== -1) {
    const wherePart = setPart.slice(whereIdx + 6).trim();
    setPart = setPart.slice(0, whereIdx).trim();
    const wMatch = wherePart.match(/(\S+)\s*=\s*(.+)/);
    if (wMatch) whereData = { col: wMatch[1], val: stripQuotes(wMatch[2].trim()) };
  }

  const setData = parseAssignments(setPart);

  let req = new MySqliteRequest().update(tableName).set(setData);
  if (whereData) req = req.where(whereData.col, whereData.val);
  return req.run();
}

// ─── DELETE ──────────────────────────────────────────────────────────────────
// DELETE FROM table [WHERE col = val]

function parseDelete(sql) {
  const fromMatch = sql.match(/DELETE\s+FROM\s+(\S+)/i);
  if (!fromMatch) throw new Error('DELETE syntax error');
  const tableName = fromMatch[1];

  let req = new MySqliteRequest().from(tableName).delete();

  const whereMatch = sql.match(/WHERE\s+(\S+)\s*=\s*(.+)$/i);
  if (whereMatch) {
    req = req.where(whereMatch[1], stripQuotes(whereMatch[2].trim()));
  }

  return req.run();
}

// ─── Parsing Utilities ────────────────────────────────────────────────────────

/**
 * Simple tokeniser that handles single-quoted strings and operators like =
 */
function tokenise(sql) {
  const tokens = [];
  let i = 0;
  while (i < sql.length) {
    // Skip whitespace
    if (/\s/.test(sql[i])) { i++; continue; }

    // Quoted string
    if (sql[i] === "'" || sql[i] === '"') {
      const q = sql[i];
      let tok = q;
      i++;
      while (i < sql.length && sql[i] !== q) {
        if (sql[i] === '\\') { tok += sql[i]; i++; }
        tok += sql[i]; i++;
      }
      tok += q; i++;
      tokens.push(tok);
      continue;
    }

    // Operator
    if (sql[i] === '=' || sql[i] === ',' || sql[i] === '(' || sql[i] === ')') {
      tokens.push(sql[i]); i++; continue;
    }

    // Word/identifier
    let tok = '';
    while (i < sql.length && !/[\s=,()]/.test(sql[i])) {
      tok += sql[i]; i++;
    }
    if (tok) tokens.push(tok);
  }
  return tokens;
}

function stripQuotes(s) {
  if (!s) return '';
  s = s.trim();
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    return s.slice(1, -1);
  }
  return s;
}

function splitValues(valStr) {
  // Split comma-separated values respecting quotes
  const parts = [];
  let cur = '';
  let inQ = false;
  let qCh = '';
  for (const ch of valStr) {
    if (!inQ && (ch === "'" || ch === '"')) { inQ = true; qCh = ch; continue; }
    if (inQ && ch === qCh) { inQ = false; continue; }
    if (!inQ && ch === ',') { parts.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur.trim());
  return parts;
}

function parseAssignments(setPart) {
  // Parse: col1 = 'val1', col2 = val2
  const data = {};
  // Split on commas that are NOT inside quotes
  const pairs = [];
  let cur = '';
  let inQ = false;
  let qCh = '';
  for (const ch of setPart) {
    if (!inQ && (ch === "'" || ch === '"')) { inQ = true; qCh = ch; cur += ch; continue; }
    if (inQ && ch === qCh) { inQ = false; cur += ch; continue; }
    if (!inQ && ch === ',') { pairs.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  pairs.push(cur.trim());

  pairs.forEach(pair => {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) return;
    const col = pair.slice(0, eqIdx).trim();
    const val = stripQuotes(pair.slice(eqIdx + 1).trim());
    data[col] = val;
  });
  return data;
}
