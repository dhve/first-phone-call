#!/bin/sh
set -e
echo "Running database migrations..."
node dist/db/migrate.js
echo "Starting host39 server..."
exec node dist/server.js
