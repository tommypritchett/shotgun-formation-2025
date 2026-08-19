# Manual test — run this before pushing

> **Why this exists.** The 94-test suite covers the socket contract and nothing else. **No
> client code has been executed at any point across four sessions** — not in a browser, not
> in a headless runner. Every claim about what the app *shows* is read from
> `client/src/App.js` source, not observed. This checklist is the only thing standing
> between those changes and your players.

## Before you start

**Everything — laptop and both phones — uses one address: `http://10.0.0.42:3000`.**
No `localhost` anywhere. A phone's `localhost` is the phone, and the bundle is built once
and served to every device, so the URL baked into it has to work from all of them.

| Piece | Address | Notes |
|---|---|---|
| Game server | `10.0.0.42:3002` | Not 3001 — your KitchoAI backend (PID 93549) has held 3001 since May. Nothing was stopped. |
| App (all devices) | `10.0.0.42:3000` | Laptop windows and phones both. |

### Network

- [ ] Laptop and **both** phones on the **same Wi-Fi**. Not one on cellular.
- [ ] **VPN off on every device.** A VPN on the laptop or either phone routes `10.0.0.42`
      somewhere it doesn't exist, and the app will just sit there failing to connect.
- [ ] If macOS asks *"Do you want the application node to accept incoming network
      connections?"* — click **Allow**. It usually appears once, when the first phone
      connects. If you clicked Deny before, fix it in
      System Settings → Network → Firewall → Options.

### Starting the servers

They are already running from the setup session. To start them yourself:

```bash
# game server — the PORT is required, 3001 is taken
PORT=3002 npm start

# app, in a second terminal
cd /Users/tommypritchett/UI-Rebuild/client && HOST=0.0.0.0 npm start
```

- [ ] **If the client dev server was already running before `client/.env.local` existed,
      restart it.** Create React App reads env files only at boot. A dev server started
      earlier still has the old value compiled in, and you would run the whole evening
      against the **live production server** without any visible sign. This is the single
      easiest way to waste the night.

### ⚠️ Pre-flight check — 30 seconds, do not skip

If this fails, every test below is meaningless *and test 3 would hammer production.*

**On the laptop:**

1. Open `http://10.0.0.42:3000`.
2. Open DevTools (`Cmd+Opt+I`) → **Network** tab → filter **WS**.
3. Reload the page.
4. You should see one WebSocket request. **Its URL must start with**
   `ws://10.0.0.42:3002/socket.io/`.

**If it says `wss://shotgunformation.onrender.com` — STOP.** You are pointed at
production. Restart the client dev server and check again.

You can also confirm it in **Console** — the app logs its socket activity there, and any
connection error will name the host it was trying to reach.

**For the phones** (you can't easily open DevTools on them), use the server log instead —
this is the more reliable check anyway, because it proves the phone reached *this* machine:

```bash
tail -f /private/tmp/claude-501/-Users-tommypritchett-UI-Rebuild/c130e13d-fce8-479c-b2ef-5cbcfc12e0af/scratchpad/shotgun-server.log
```

Load the app on each phone. Each one should produce a fresh line:

```
A user connected: <socket id>
```

**No new line when a phone loads the page = that phone is not talking to your laptop.**
Either it's on a different network, a VPN is on, or the firewall blocked it.

### What needs real hardware

| Test | Devices |
|---|---|
| 1, 2 | **Two real phones + laptop.** These are about a phone's radio actually dropping. An incognito window closes cleanly; a phone in a pocket does not. |
| 3 | Laptop is enough — 6 windows (3 normal + 3 incognito) is fine. Different games, not different networks. |
| 4, 5, 6 | Incognito windows are fine. Nothing here depends on the network layer. |

A room needs **3 players minimum** to start. Every test below assumes three.

---

## 1. The mid-round drink fix — the whole reason we are deploying

This is the change most likely to be noticed and the one with the least real-world
evidence behind it. **If only one test gets run, run this one.**

| # | Do this | Expect |
|---|---|---|
| 1.1 | Phone A, Phone B, laptop join one room. Laptop is host. Start the game. | All three see a hand of 5 standard + 2 wild cards. |
| 1.2 | Host declares **First Down**. Let the 6s timer run out. | Everyone's total goes to **1**. |
| 1.3 | Host declares a card the host is holding. Host pours **3 drinks into Phone A**. Let the timer expire. | Phone A total = **4**. Write this number down. |
| 1.4 | Host declares another card and starts pouring. **While the timer is still counting**, put Phone A into airplane mode. | Phone A goes offline. The other two keep playing. |
| 1.5 | Host pours **2 drinks into Phone A** (tap A's avatar twice) while A is offline. Let the timer expire. | Host and Phone B see the round finish normally. |
| 1.6 | Turn airplane mode off. Let Phone A reconnect. | Phone A returns to the game with its hand. |
| 1.7 | **Check Phone A's total on all three screens.** | **6** — the 4 from before plus the 2 poured while it was away. ⚠️ On `main` this reads **4**: the 2 are silently deleted. Seeing 4 here means the fix did not take. |
| 1.8 | Play one more normal round and re-check. | Totals keep accumulating correctly from 6. No number ever goes down. |

**Watch for:** a total that goes *up* by more than it should. That would mean the merge is
double-counting, which is the failure mode opposite to the bug and would be worse.

---

## 2. Browser refresh mid-round — the most common real case

Nobody airplane-modes their phone. They do hit refresh when the app looks stuck.

| # | Do this | Expect |
|---|---|---|
| 2.1 | Fresh game, 3 players. Give **Phone B** a total of at least 5 across two rounds. | Phone B's total is right on all screens. |
| 2.2 | Host declares a card. **While the timer is running**, hit reload on Phone B. | Phone B reloads and rejoins on its own — the room code and name come from the URL, so it should not ask you to type anything. |
| 2.3 | After reload, look at Phone B's screen while the round is still live. | Phone B is back in the game with its hand. ⚠️ **Known gap, not a regression:** the timer on Phone B will be wrong or absent. The server sends a `roundState` event with the correct time, but the client has no listener for it. Note what it actually shows — that is new information. |
| 2.4 | Let the round finish. Check Phone B's total everywhere. | Includes everything poured into B during that round. |
| 2.5 | Repeat 2.2 twice in a row without letting a round finish. | Still correct. This is the A→B→C double-reconnect case. |

---

## 3. Two concurrent games — the outage bug

On `main` this kills the server. Worth seeing fail once on purpose if you have the patience,
so you know what it looked like.

| # | Do this | Expect |
|---|---|---|
| 3.1 | Open 6 browser windows (3 normal, 3 incognito). Start **two separate games**, 3 players each. Note both room codes. | Two independent games, two different codes. |
| 3.2 | In game 1, run a full round and pour some drinks. | Game 1 totals correct. |
| 3.3 | **Now start game 2's first round.** | ⚠️ This is the exact moment the old server died. Game 1's windows must keep working — cards still visible, no disconnect. |
| 3.4 | Run rounds in both games, alternating, pouring different amounts. | Each game's scoreboard shows **only its own 3 players**. No stranger's name or number ever appears. |
| 3.5 | Watch the server terminal throughout. | No `TypeError`, no crash, no restart. The process stays up. |
| 3.6 | Let both games run several rounds. | Totals stay independent and correct. |

**Bonus — the two-Mikes case (test 3.7).** Worth doing; it is a real bug I found today and
the fix touches the reconnection code.

| # | Do this | Expect |
|---|---|---|
| 3.7 | Both games have a player named **Mike**. Give game 2's Mike a big total (say 9). Give game 1's Mike a small one (say 4). Drop game 2's Mike. Now disconnect and reconnect **game 1's Mike**. | Game 1's Mike still has **4**, not 9. And when game 2's Mike comes back, he still has **9**, not 0. ⚠️ On `main` game 1's Mike is awarded 9 and game 2's Mike is wiped. |

---

## 4. Host leaves mid-game

| # | Do this | Expect |
|---|---|---|
| 4.1 | 3 players, game running, at least one round played. | Totals on the board. |
| 4.2 | Host closes their tab (or uses Leave Game). | The other two get a message naming the new host. |
| 4.3 | On the new host's screen, declare a card. | The declare control is actually available and the round runs — a host who cannot host is the real failure here. |
| 4.4 | Finish the round, pour some drinks. | Totals still correct, including the departed host's last-known numbers. |

---

## 5. The swap guard — make sure it does not block the legitimate swap

New behaviour this session. The risk is being too strict, not too loose.

| # | Do this | Expect |
|---|---|---|
| 5.1 | 3 players, game running. Host taps **Next Quarter**. | Everyone sees quarter 2, and the wild-card swap modal opens on each player. |
| 5.2 | Each player swaps one wild card. | **All three swaps work.** Each player's chosen card is replaced with a different one. ⚠️ If any legitimate first swap fails, stop and tell me — that is the guard being wrong. |
| 5.3 | Host taps **Next Quarter** again. | Modal opens again for everyone; a second swap works in quarter 3. |
| 5.4 | Play a full quarter with swaps each time, 4 quarters. | Every quarter gives every player exactly one working swap. |
| 5.5 | **Edge case worth knowing about:** after swapping in a quarter, disconnect a player and let them reconnect *in the same quarter*. | They may be shown the swap modal again — the client opens it whenever it hears the quarter number. If they pick a card, the modal will close and **their hand will not change**. This is intended: they already used their swap. It is a cosmetic wart, not a break. Note whether it looks confusing enough to care about. |

---

## 6. `actionInProgress` — completely unexercised

The client handles this with a browser `alert()` (`App.js:1149`). No test has ever run it
and I have never seen it on screen. **This step is information-gathering, not pass/fail.**

| # | Do this | Expect |
|---|---|---|
| 6.1 | Host declares a card. **While the timer is still running**, get the host to declare another one. | A native browser alert appears saying an action is in progress. |
| 6.2 | Write down: what does it look like on a **phone**? Does it block the whole screen? Can you still see the timer behind it? | Record it. On mobile a native alert is modal and full-width, and it may cover the round entirely. |
| 6.3 | Dismiss it. | The original round continues normally and its timer never paused. |
| 6.4 | Confirm the second declaration did **not** double anyone's drinks. | Totals reflect one round, not two. |

---

## If something fails

Note **which numbered step**, what you saw versus what is above, and whether the server
terminal printed anything. The step number maps to a specific change:

| Step | Change | Back it out with |
|---|---|---|
| 1.x, 2.x | mid-round merge reorder | `git revert b71899a` (also reverts the room-code retry) |
| 3.7 | room-scoped name lookups | `git revert cde95c3` |
| 5.x | swap guard | `git revert a5889ce` |
| 3.1–3.6 | Phase 1 concurrency fixes | `git revert 5d0a8ef` — **do not**, this is the outage fix |

Each is an independent commit, so you can drop one without losing the others.
