# Recording the real Hermes stream

The parser in `lib/sse.ts` follows the *assumed* `/v1/responses` event shape.
Before relying on chat, record a real stream on the Hermes machine and make it the fixture:

```bash
curl -sN http://127.0.0.1:8642/v1/responses \
  -H "Authorization: Bearer $HERMES_API_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"hermes-agent","input":"What is due this week? Use job_os.py due.","stream":true,"store":true,"conversation":"job-os:fixture"}' \
  > test/fixtures/hermes-live.sse
```

Then:

1. Remove anything personal from the file (it is committed to a public repo) or keep it out of git.
2. Add a test in `test/sse.test.ts` that feeds it to `parseSSE` + `mapHermesEvent` and expects at least one `delta`, one `tool` and one `done`.
3. Adjust `mapHermesEvent` until it passes.
