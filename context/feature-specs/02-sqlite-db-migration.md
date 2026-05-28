i want us to move from using postgresql cloud db instance to a local sqlite db, still using the prisma sqlite adapter.

the db path can be "const DB_PATH = path.join(os.homedir(), '.config', 'koincode', 'data.db')"

is it possible for us to start the server on cli startup. we spawn a bun process and use a port, store the pid in the config path as well.

something like this
``` 
import { fileURLToPath } from 'url'
import path from 'path'
import os from 'os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const isDev = process.env.NODE_ENV === 'development'

const SERVER_BINARY = isDev
  ? path.join(__dirname, '../../server/src/index.ts')  // source file in dev
  : path.join(__dirname, 'server.js')                  // compiled binary in prod

export function startServer() {
  const command = isDev ? 'bun' : 'bun'
  const args = isDev
    ? ['--watch', SERVER_BINARY]   // hot reload in dev
    : [SERVER_BINARY]              // just run in prod

  const server = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || 'production',
      PORT: String(SERVER_PORT)
    }
  })

  fs.writeFileSync(PID_FILE, String(server.pid))
  server.unref()
}
```
on startup we check if the server is running, if not we start it. if it is running, we check if it is the correct port, if not we start it on the correct port and move on.

think about if there's a better way to handle this.

on the server we also tracks the last request time and shuts itself down after N minutes of no activity

and should we also run migrations whenever we start the server, for prod and dev?