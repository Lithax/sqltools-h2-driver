# SQLTools H2 Driver

[SQLTools](https://marketplace.visualstudio.com/items?itemName=mtxr.sqltools) driver for the **H2 database** (H2 2.x).

Node can't speak H2's protocol, so the driver runs a tiny Java JDBC bridge (`bridge/H2Bridge.java`, started with
Java's single-file launcher) and talks to it over stdin/stdout. No Maven, no Java compile step.

## Requirements
- VS Code + the **SQLTools** extension
- **Java 11+** on your PATH (or set the path in the connection)

That's it: the H2 jar is downloaded for you.

## Install
```bash
npm install
npm run package          # -> sqltools-h2-driver-0.1.0.vsix
code --install-extension sqltools-h2-driver-0.1.0.vsix
```
(or press F5 to run it in an Extension Development Host)

## Connecting
SQLTools → Add New Connection → **H2**. Pick **Connect using**:

| Method | Fields |
|---|---|
| **Embedded (file)** | Database file (with a *Select File* button; `.mv.db` extension optional), *Create the database if it doesn't exist*, *AUTO_SERVER* |
| **Server (TCP)** | Server address, port (9092), database (`~/test`, `test`, `mem:test`…) |
| **JDBC URL** | Any H2 URL, e.g. `jdbc:h2:mem:test;DB_CLOSE_DELAY=-1` |

Embedded and Server also take **Extra URL parameters** (`MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE`).
Username defaults to `sa`; password can be empty, saved in settings, or asked on connect.

Notes
- A typo in the embedded path does **not** silently create a new empty database unless you tick *Create the database if it doesn't exist*.
- An embedded file can be open in only one process at a time. Tick *AUTO_SERVER* (and use `AUTO_SERVER=TRUE` in your app) to share it.

## The H2 jar
The **H2 jar** setting has two choices:

- **Auto-download latest H2** (default): on first connect the newest H2 is fetched from Maven Central into
  `~/.sqltools-h2/` (SHA-1 verified) and reused afterwards.
- **Use my own h2.jar**: pick a file with *Select File*. Use this to pin a version, e.g. for old 1.4.x database files
  (databases written by H2 1.4 can't be opened by 2.x).

The connection form can't host custom buttons, so the one-click download lives here instead:
- a notification on first start with a **Download latest** button, and
- the command palette command **SQLTools H2: Download latest h2.jar** (run it again later to update).

Behind a proxy or mirror? Set `SQLTOOLS_H2_MAVEN_URL` to your mirror's `.../com/h2database/h2` folder,
or just download the jar manually and use *Use my own h2.jar*.

## Not included (on purpose)
Primary/foreign-key markers, functions/sequences in the tree, H2 1.4.x metadata (2.x INFORMATION_SCHEMA is assumed).
