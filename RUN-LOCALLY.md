# ProofLock ko apne laptop par chalana

Do tarike hain: **one-click launcher** (aasan) ya **manual commands** (jab launcher me kuch galat ho).

---

## 1. Ek baar ki taiyari (prerequisites)

| Chahiye | Version | Kahan se |
| --- | --- | --- |
| Python | **3.11 ya usse naya** | <https://www.python.org/downloads/> — install karte waqt **"Add python.exe to PATH"** tick karna zaroori hai |
| Node.js | **22 LTS** | <https://nodejs.org/> (npm saath aata hai) |
| Arduino IDE | 2.x | Sirf tab chahiye jab board par firmware daalna ho: <https://www.arduino.cc/en/software> |

Install ke baad **command prompt band karke naya kholo**, warna PATH update nahi milega. Check:

```bat
py -3 --version
node -v
npm -v
```

Teenon version dikhne chahiye. `py` command na chale to `python --version` try karo.

---

## 2. Sabse aasan tarika (Windows)

1. Repository folder kholo (`D:\proof lock`).
2. **`start-windows.bat`** par double-click karo.

Yeh script khud hi:

- pehli baar `.venv` banata hai aur backend packages install karta hai,
- pehli baar `frontend/node_modules` install karta hai,
- `frontend/dist` build karta hai,
- `config/operators.json` example se copy karta hai (agar nahi hai),
- browser me `http://127.0.0.1:8000` kholta hai.

**Us window ko band mat karo** — server usi me chalta hai. Band karte hi dashboard ruk jayega.

PowerShell se chalana ho to:

```powershell
cd "D:\proof lock"
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

macOS / Linux par:

```bash
chmod +x start-mac-linux.sh
./start-mac-linux.sh
```

---

## 2b. Naya code update karna (purana folder refresh)

Jab repo me naye changes aayen (jaise sketch me card enroll hua), poora folder dobara download karne ki zaroorat nahi:

```powershell
cd "D:\proof lock"
powershell -ExecutionPolicy Bypass -File .\update.ps1 -Rebuild
```

Yeh script:

- GitHub se latest `main` download karta hai,
- source files overwrite karta hai,
- par **`.venv`, `frontend\node_modules`, `frontend\dist`, `data\` aur `config\operators.json` ko chhod deta hai** (aapka login data aur naam safe rahenge),
- `-Rebuild` ke saath frontend dobara build kar deta hai.

**Server pehle band karo** (us window me Ctrl+C), phir update chalao, phir `start.ps1`.

Agar aapke folder me `update.ps1` nahi hai (purana download), to ek baar yeh file [GitHub se](https://raw.githubusercontent.com/k0hinoor/PROOF-LOCK/main/update.ps1) download karke `D:\proof lock` me rakh do — uske baad yeh script khud ko bhi update kar leta hai.

### Saari files seedha isi folder me (bina replace karne ke jhanjhat ke)

Agar aap chahte ho ki download ki hui **har file** seedha usi folder me aa jaye jahan project hai:

```powershell
cd "D:\proof lock"
powershell -ExecutionPolicy Bypass -File .\fetch.ps1
```

`fetch.ps1` GitHub se `PROOF-LOCK-main` folder nikal ke uska **content** seedha aapke folder me daal deta hai (hidden `.github`, `.gitignore` bhi), phir frontend build kar deta hai. Aapki `.venv`, `node_modules`, `data` aur `config\operators.json` waise hi rehti hain kyunki woh download me nahi hoti.

### Ek hi paste me saari files download

Script save kiye bina, PowerShell me yeh paste karo (PowerShell folder me hi kholo):

```powershell
$tmp = Join-Path $env:TEMP ("pl-" + [guid]::NewGuid())
Invoke-WebRequest https://codeload.github.com/k0hinoor/PROOF-LOCK/zip/refs/heads/main -OutFile "$tmp.zip" -UseBasicParsing
Expand-Archive "$tmp.zip" -DestinationPath $tmp -Force
Get-ChildItem "$tmp\PROOF-LOCK-main" -Force | Copy-Item -Destination . -Recurse -Force
Remove-Item $tmp, "$tmp.zip" -Recurse -Force
```

43 files aa jayengi (hidden `.github`, `.gitignore` bhi). `data`, `.venv`, `node_modules` aur `config\operators.json` chhue nahi jate.

---

## 3. Manual commands (Windows PowerShell)

```powershell
cd "D:\proof lock"

# 1) Python environment (sirf pehli baar)
py -3 -m venv .venv

# 2) Backend packages (sirf pehli baar, ya requirements badalne par)
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt

# 3) Frontend packages (sirf pehli baar)
npm --prefix frontend ci

# 4) Frontend build (har code change ke baad)
npm --prefix frontend run build

# 5) Server chalao
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Browser me kholo: **<http://127.0.0.1:8000>**

macOS / Linux me same cheezein is tarah:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
npm --prefix frontend ci
npm --prefix frontend run build
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

---

## 4. Pehli baar kholne par kya dikhega

Dashboard **locked gate** par khulega — yeh sahi behaviour hai, bug nahi. Kyunki motor controls sirf RFID scan ke baad milte hain.

- **Hardware juda hai:** gate par "Scan your ID card" dikhega. Card lagao.
- **Hardware nahi juda:** gate par `Machine controller offline` aur **Start simulator** button dikhega. Us par click karo, phir dropdown se operator chuno aur **Present card** dabao — pura flow bina Arduino ke dikh jayega.

Simulator ka data hamesha **SIMULATED DATA** label ke saath aata hai aur asli records se alag rehta hai.

---

## 5. Asli Arduino jodna

1. `firmware\prooflock_uno\prooflock_uno.ino` Arduino IDE me kholo aur Uno par upload karo (steps: `firmware/README.md`).
2. Arduino Serial Monitor **band** karo — warna port busy rahega.
3. Dashboard me **Machine link** → port refresh → apna COM port chuno (jaise `COM3`) → **Connect**.
4. Card scan karo. Agar `ACCESS DENIED · card not registered` aaye, to us `OP-nn` ko `config/operators.json` me add karo:

```json
{
  "operators": [
    { "ref": "OP-01", "name": "Engineer A" },
    { "ref": "OP-02", "name": "Vaibhav" }
  ]
}
```

File save karke page reload kar do. (Ya dashboard ke `/api/operators/reload` se reload hota hai.)

5. **Diagnostics** tab me valid packets badhte dikhne chahiye. Uske baad hi MOTOR ON enable hoga.

> Zaroori: sketch me `STANDSTILL_CALIBRATED = false` hai, isliye board solenoid release nahi karega aur `NOT_VERIFIED` bhejega. Yeh jaan-boojh kar hai — pehle `docs/test-plan.md` ke hisaab se threshold calibrate karo, tab `true` karo.

---

## 6. Aam problems

| Problem | Wajah / hal |
| --- | --- |
| `py` ya `python` not found | Python install karte waqt PATH tick nahi hua. Dobara install karo ya `py -3` ki jagah poora path do. |
| `npm` not found | Node.js install nahi hai, ya terminal purana hai. Naya PowerShell kholo. |
| `tsc: not found` | `npm --prefix frontend ci` nahi chala. Step 3 dohrao. |
| Page khulti hai par blank / purana design | `npm --prefix frontend run build` chalao, phir browser me **Ctrl+F5** (hard refresh). |
| `Port 8000 already in use` | Purana server band karo (us window me Ctrl+C), ya `--port 8001` use karo aur browser me wahi khоlo. |
| Diagnose me "Open port, no current values" | Galat COM port / baud, ya Serial Monitor khula hai. Sketch 115200 baud par chalta hai. |
| Card scan par kuch nahi hota | Gate par Reader `Not connected` — pehle **Connect** karo. Ya sketch me card enrol nahi hua (`ENROLL_MODE`). |
| MOTOR ON disabled hai | Panel khud wajah batata hai: guard open / lock released / safety fault / feedback stale. Board bhi same command refuse karta hai. |
| Windows par "Access is denied" upload karte waqt | Dashboard band karo (Ctrl+C), Serial Monitor band karo, phir upload. |

---

## 7. Rozana ke commands (dobara setup ki zaroorat nahi)

```powershell
cd "D:\proof lock"
npm --prefix frontend run build          # sirf jab frontend code badla ho
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Ya seedha `start-windows.bat` — woh build bhi kar deta hai aur browser khol deta hai.

## 8. Test chalana (optional)

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
.\.venv\Scripts\python.exe -m unittest discover -s firmware/tests -v
```

Windows par serial test automatically skip hota hai (woh POSIX pseudo-terminal use karta hai); baaki sab chalte hain.
