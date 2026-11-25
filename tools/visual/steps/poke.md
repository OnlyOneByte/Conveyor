`poke` clicks every match in the page's own DOM without waiting, so a disabled control stays inert where Playwright's click would wait for it. It fails if nothing matches.
