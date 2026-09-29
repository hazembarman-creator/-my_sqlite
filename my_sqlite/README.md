# Welcome to My Sqlite
***

## Task
Relational databases like SQLite use SQL to query structured data stored in tables. The challenge is to **replicate that behavior from scratch** — reading and writing CSV files as tables, parsing SQL-like commands, and supporting SELECT, INSERT, UPDATE, DELETE, JOIN, WHERE, and ORDER BY — all without any database engine.

## Description
The project is split into two parts:

**Part 00 — `my_sqlite_request.js`**
A chainable query-builder class (`MySqliteRequest`) that mimics SQLite's request lifecycle. Each method (`from`, `select`, `where`, `join`, `order`, `insert`, `values`, `update`, `set`, `delete`) returns a new instance, progressively building the request. Calling `run()` executes it — reading from, and writing back to, `.csv` files on disk.

**Part 01 — `my_sqlite_cli.js`**
An interactive Command Line Interface built with Node's `readline` module. It accepts standard SQL syntax, parses it into `MySqliteRequest` calls, and prints results in a pipe-separated format — just like a real database shell.

## Installation
Make sure you have [Node.js](https://nodejs.org/) installed (v14+), then clone or download the project files:

```bash
# No dependencies required — uses Node.js built-ins only
node --version   # confirm Node is installed
```

Place your `.csv` data files in the same directory as the scripts.

## Usage

### Interactive CLI
```bash
node my_sqlite_cli.js
```

Once inside the prompt, type SQL commands ending with `;`:

```sql
my_sqlite_cli> SELECT * FROM nba_player_data.csv;
my_sqlite_cli> SELECT name FROM nba_player_data.csv WHERE birth_state = Indiana;
my_sqlite_cli> INSERT INTO nba_player_data.csv VALUES (Magic Johnson, Michigan, G);
my_sqlite_cli> UPDATE nba_player_data.csv SET position = PG WHERE name = Magic Johnson;
my_sqlite_cli> DELETE FROM nba_player_data.csv WHERE name = Magic Johnson;
my_sqlite_cli> quit
```

### Programmatic API
```js
const MySqliteRequest = require('./my_sqlite_request');

// SELECT with WHERE
new MySqliteRequest()
  .from('nba_player_data.csv')
  .select('name')
  .where('birth_state', 'Indiana')
  .run();
// => [{ name: 'Andre Brown' }, { name: 'Larry Bird' }]

// INSERT
new MySqliteRequest()
  .insert('nba_player_data.csv')
  .values({ name: 'Magic Johnson', birth_state: 'Michigan', position: 'G' })
  .run();

// UPDATE
new MySqliteRequest()
  .update('nba_player_data.csv')
  .set({ position: 'PG' })
  .where('name', 'Magic Johnson')
  .run();

// DELETE
new MySqliteRequest()
  .from('nba_player_data.csv')
  .delete()
  .where('name', 'Magic Johnson')
  .run();
```

### The Core Team


<span><i>Made at <a href='https://qwasar.io'>Qwasar SV -- Software Engineering School</a></i></span>
<span><img alt='Qwasar SV -- Software Engineering School\'s Logo' src='https://storage.googleapis.com/qwasar-public/qwasar-logo_50x50.png' width='20px' /></span>