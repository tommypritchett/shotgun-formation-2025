# Why the build sets `CI=false`

`create-react-app`'s `react-scripts build` treats **every ESLint warning as a
fatal error when `process.env.CI` is truthy**. Measured in this repo on
2026-09-10:

```
$ CI=true NODE_ENV=production npx react-scripts build
Treating warnings as errors because process.env.CI = true.
Failed to compile.
$ echo $?
1
```

The same command without `CI` compiles and exits 0.

This project carries a standing set of warnings — unused imports left in
`App.js` by the live-feed work, and `import/no-anonymous-default-export` on the
`client/src/lib/*` modules. None of them is a defect; the anonymous-default one
in particular fires on a deliberate, documented export style used throughout.

So one warning anywhere is the difference between a deploy and a silent
failure, and the failure mode is the worst kind: the push is accepted, GitHub
shows it, and the site keeps serving the previous build with nothing obviously
wrong.

`CI=false` is set **only on the client build step in the root `build` script**,
which is the command Render runs. It is deliberately not set globally: the test
suite is unaffected, and CI-ness still means what it should everywhere else.

## What this does NOT claim

Render is **not known** to set `CI=true`. This was found while investigating
four undeployed pushes and is a latent landmine rather than a proven cause —
if Render had been setting `CI=true` all along, nothing would ever have
deployed, and `c00e7aa` did. It is fixed because it is cheap, correct, and
would produce exactly the symptom being investigated if the build environment
ever changed.

## The real fix, if warnings are ever cleaned up

Delete `CI=false` and let warnings be errors again. That is the better end
state; it is just not a change to make in the same breath as an urgent deploy,
because clearing the `App.js` warnings means touching game code.
