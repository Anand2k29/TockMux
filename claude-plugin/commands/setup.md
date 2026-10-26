---
description: Install the browser TockMux needs and check that everything works
allowed-tools: Bash(npx -y tockmux:*)
---

Set up TockMux on this computer.

1. Run the setup check:

   ```bash
   npx -y tockmux doctor
   ```

2. If the browser is missing, download it once:

   ```bash
   npx -y tockmux setup
   ```

3. Run the demo to prove the whole pipeline works, then tell the user where the file is:

   ```bash
   npx -y tockmux demo
   ```

4. Summarise the result in plain words. If something is still missing, say what to install.
