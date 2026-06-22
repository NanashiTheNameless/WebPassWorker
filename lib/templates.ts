import { escapeHtml } from './utils.js'

export function makeLoginForm(message = ''): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Protected — WebPassWorker</title>
  <style>
    :root{--bg:#16161D;--fg:#F2F2F2;--muted:rgba(242,242,242,0.72);--border:rgba(242,242,242,0.10)}
    html,body{height:100%;margin:0;font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;background:var(--bg);color:var(--fg)}
    .wrap{min-height:100%;display:flex;align-items:center;justify-content:center;padding:32px}
    .card{width:100%;max-width:420px;background:var(--bg);border:1px solid var(--border);padding:28px;border-radius:12px}
    h1{margin:0 0 8px;font-size:20px}
    p{margin:0 0 18px;color:var(--muted);font-size:14px}
    form{display:flex;gap:10px;flex-direction:column}
    label{display:flex;flex-direction:column;font-size:13px;color:var(--fg)}
    input[type="password"]{margin-top:8px;padding:10px 12px;border-radius:8px;border:1px solid rgba(242,242,242,0.14);background:var(--bg);color:var(--fg);outline:none}
    input[type="password"]:focus{box-shadow:0 0 0 6px rgba(242,242,242,0.06);border-color:rgba(242,242,242,0.18)}
    button{margin-top:6px;padding:10px 12px;border-radius:8px;border:1px solid rgba(242,242,242,0.18);background:var(--fg);color:var(--bg);font-weight:600;cursor:pointer}
    .help{margin-top:12px;font-size:12px;color:var(--muted)}
    footer{margin-top:14px;font-size:12px;color:var(--muted);text-align:center}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card" role="main">
      <h1>Access required</h1>
      <p>${escapeHtml(message)}</p>
      <form method="POST" action="/__pw_gate_login" autocomplete="off">
        <label>Password<input name="password" type="password" autocomplete="new-password" required maxlength="1000" /></label>
        <button type="submit">Unlock</button>
      </form>
      <div class="help">This site is password protected.<br>Your browser will be remembered for one day.</div>
      <footer>Contact the administrator if you need access.</footer>
    </div>
  </div>
</body>
</html>`
}

export function makeDenyPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Access denied</title>
  <style>
    :root{--bg:#16161D;--fg:#F2F2F2;--muted:rgba(242,242,242,0.78);--border:rgba(242,242,242,0.10)}
    html,body{height:100%;margin:0;font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;background:var(--bg);color:var(--fg);display:flex;align-items:center;justify-content:center}
    .card{max-width:720px;padding:28px;border-radius:12px;background:var(--bg);border:1px solid var(--border)}
    h1{margin:0 0 8px;font-size:22px}
    p{margin:0;color:var(--muted)}
    a{color:var(--fg)}
  </style>
</head>
<body>
  <div class="card">
    <h1>Access denied</h1>
    <p>We couldn't verify your credentials.<br>Please try again or contact the site administrator for assistance.</p>
    <a href="/">Try again</a>
  </div>
</body>
</html>`
}

export function makeRateLimitedPage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60))
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Too many attempts</title>
  <style>
    :root{--bg:#16161D;--fg:#F2F2F2;--muted:rgba(242,242,242,0.78);--border:rgba(242,242,242,0.10)}
    html,body{height:100%;margin:0;font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;background:var(--bg);color:var(--fg);display:flex;align-items:center;justify-content:center}
    .card{max-width:720px;padding:28px;border-radius:12px;background:var(--bg);border:1px solid var(--border)}
    h1{margin:0 0 8px;font-size:22px}
    p{margin:0 0 16px;color:var(--muted)}
    a{color:var(--fg)}
  </style>
</head>
<body>
  <div class="card">
    <h1>Too many attempts</h1>
    <p>Password entry is temporarily limited.<br>Please try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.</p>
    <a href="/">Return to login</a>
  </div>
</body>
</html>`
}
