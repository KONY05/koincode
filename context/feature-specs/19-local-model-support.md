i've been seeing tools like opencode, aider, etc they allow users to connect local models to the platform instead of using the default models, i think this would be a great addition to koincode to allow users to use their own local models

---

## Manual Verification

### Prerequisites
- koincode built and linked (`bun run build:cli && bun run link:cli`)
- [Ollama](https://ollama.com) installed (`brew install ollama` on Mac)

---

### 1. Ollama not running — graceful empty state

1. Make sure Ollama is **not** running (quit the Ollama app or just don't start it)
2. Launch koincode: `koincode`
3. Open the model picker: type `/models` and press Enter
4. Press **Tab** twice to reach the **Local** tab

**Expected:** "Ollama not detected at http://localhost:11434" message with an install hint. No crash or spinner stuck forever.

---

### 2. Ollama running but no models pulled

1. Start Ollama: `ollama serve` (in a separate terminal)
2. Make sure you have **no** models pulled: `ollama list` should show an empty table
3. Open koincode, go to `/models` → Local tab

**Expected:** "No models pulled yet. Run: ollama pull llama3.2" hint message.

---

### 3. Ollama running with models — model appears in picker

1. Pull a model: `ollama pull llama3.2` (or any other)
2. Confirm it appears: `ollama list`
3. Open koincode, go to `/models` → Local tab

**Expected:**
- Model name (e.g. `llama3.2`) visible in the list
- File size shown alongside (e.g. `2.0GB`)
- Searchable by name

---

### 4. Select a local model and start chatting

1. In the Local tab, select a model (e.g. `llama3.2`)
2. The status bar at the bottom should update to show `ollama/llama3.2`
3. Start a new session (`/new`) and send a simple message: "Hello, who are you?"

**Expected:** The model responds. The response streams in normally.

---

### 5. Model persists across restarts

1. Select a local model as above
2. Quit koincode (`/exit`) and relaunch
3. Check the status bar

**Expected:** The local model is still selected (saved in `~/.koincode/config.json` as `defaultModel`).

---

### 6. Custom Ollama URL (non-default port)

1. Run Ollama on a non-default port: `OLLAMA_HOST=127.0.0.1:11435 ollama serve`
2. Set the custom URL in `~/.koincode/config.json`:
   ```json
   { "ollamaBaseURL": "http://localhost:11435" }
   ```
3. Restart koincode and open the Local tab

**Expected:** Models from the custom-URL Ollama instance appear.

---

### 7. Switch back to a cloud model

1. While a local model is selected, open `/models`
2. Switch to the **Frontier** tab and pick any cloud model (e.g. `claude-sonnet-4-6`)
3. Send a message

**Expected:** Responds normally using the cloud model. No stale local model state.
