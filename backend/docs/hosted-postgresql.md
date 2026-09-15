# Hosted PostgreSQL with Neon

This project is prepared for Neon PostgreSQL using Prisma's PostgreSQL adapter.
The database runs in Neon; `backend/.env` holds connection settings only.
No PostgreSQL installation or local database file is needed.

## 1. Create your database

1. Sign in or create an account at [Neon Console](https://console.neon.tech).
2. Create a project named `pulse-ai`. Choose the region closest to where you will run the backend. Review the selected plan before creating the project.
3. Use a dedicated development database for this application. The default database name is fine.
4. Open the project's **Connect** dialog and select that database and its role.

## 2. Configure the backend

Open `backend/.env` (already prepared and ignored by Git):

```dotenv
DATABASE_URL="PASTE_POOLED_POSTGRESQL_URL_HERE"
DIRECT_URL="PASTE_DIRECT_POSTGRESQL_URL_HERE"
```

Copy the connection string with **Connection pooling enabled** into `DATABASE_URL`.
Copy it again with **Connection pooling disabled** into `DIRECT_URL`.
Both must refer to the same branch and database. The pooled hostname contains `-pooler`.
Copy the entire URL, including its TLS parameters; do not remove `sslmode` or channel binding settings.

Keep the URLs in this backend environment file. Do not paste them into chat or put them in frontend configuration.
If `backend/.env` does not exist in a fresh checkout, copy `.env.example` to `.env` first.

## 3. Initialize the database

From the repository root in PowerShell:

```powershell
cd backend
npm.cmd run db:setup
npm.cmd run start:dev
```

`db:setup` generates Prisma Client, applies checked-in migrations, and seeds the demo employee and timesheets.
It stops if a step fails. Re-running it applies pending migrations and leaves existing seed records unchanged.
Use it for the development database; for production, run `db:migrate` without demo seeding and configure real employee accounts and authentication.

The setup has not been applied to a hosted database until real connection URLs have been supplied.
An unavailable database causes backend startup to fail; there is no JSON storage fallback.

## 4. Verify

After startup, open `http://localhost:4000/api/v1/employee/me` to verify the seeded development account.
Save a timesheet through the frontend, restart the backend, and check that the saved hours remain.

## References

- [Neon account setup](https://neon.com/docs/get-started-with-neon/signing-up)
- [Neon application connections](https://neon.com/docs/connect/connect-from-any-app)
- [Neon connection pooling](https://neon.com/docs/connect/connection-pooling)
