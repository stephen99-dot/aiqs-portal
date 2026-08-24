# Deploying

The portal is a single Node service. The evidence sidecar (`evidence/`) runs
**inside the same container**, as a child process of the Node server started by
`server/evidenceSupervisor.js` on boot.

## Why not a second service

The sidecar reads uploaded drawings **by path**. On Render — or any host where
each service gets its own filesystem — a separate sidecar service would never
see the uploads. One container, one disk, one deploy, and its lifecycle follows
the portal's automatically.

## Turning the evidence layer on

One change: add the pip install to your **build command**.

```
npm install && npm run build && pip install -r evidence/requirements.txt
```

That is the whole deployment. No second service, no port to expose — the sidecar
listens on `127.0.0.1:8021`, reachable only from inside the container.

On the next deploy the logs will say which of these happened:

```
[Evidence] starting on http://127.0.0.1:8021 using python3
[Evidence] ready — scale proofs and vector harvesting are available to Atlas.
```

or, if the pip install has not been added:

```
[Evidence] OFF — no Python interpreter with PyMuPDF was found. Takeoffs will be
measured visually and reported as estimates rather than proven measurements.
```

**The portal runs either way.** Without the evidence layer the scale gate stays
dormant, Atlas measures visually, and every takeoff is reported as `visual_only`
— estimates rather than proven measurements. That is deliberate: a missing
evidence layer lowers the stated confidence of a takeoff, it never stops the
portal.

## Verifying it

```bash
curl -s https://your-portal/api/health
# {"ok":true,"evidence":"ready","uptime_s":42}
```

`evidence` is `ready` or `off`. If it is `off` after adding the pip line, check
the build log for a PyMuPDF install failure.

Then run one job through Atlas. In the live panel `page_inventory` and
`prove_scale` should be called **before** any takeoff item is recorded. If a
takeoff item is attempted first the tool returns `REFUSED` and tells Atlas to
prove the scale — that is the gate working, not an error.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `EVIDENCE_ROOT` | `/` | Restricts which paths the sidecar will open. Set it to your project root. |
| `EVIDENCE_PORT` | `8021` | Port inside the container. Moves both the sidecar and the client. |
| `EVIDENCE_HOST` | `127.0.0.1` | Interface the sidecar binds to. |
| `EVIDENCE_DISABLED` | unset | `1` stops the supervisor spawning it — use with `EVIDENCE_URL`. |
| `EVIDENCE_URL` | derived from host/port | Point at a sidecar you run yourself. |
| `PYTHON_BIN` | `python3`, then `python` | Force a specific interpreter. |
| `STRICT_RECALC` | strict (on) | `0` reverts to warn-and-ship on a bill that does not reconcile. Leave it strict. |
| `STRICT_ISSUE_GATE` | warn | `1` hard-fails generation when the deliverable gate finds a defect. |
| `BLENDED_DAY_RATE` | `250` | Single-operative day rate for the labour governor and programme engine. |

## Running the sidecar separately

If you would rather run it as its own process, set `EVIDENCE_DISABLED=1` on the
portal, point `EVIDENCE_URL` at it, and make sure **both processes mount the same
uploads volume**. Without a shared filesystem the sidecar cannot open the
drawings and every call fails.

```bash
cd evidence
pip install -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 8021
```

## Tests

```bash
npm test                              # Node
cd evidence && python3 -m pytest -q   # Python
```
