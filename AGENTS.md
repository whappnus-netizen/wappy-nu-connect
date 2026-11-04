<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
 
Landing media is selected from an explicit public-file inventory with safe fallbacks; absent optional uploads must never produce broken requests.

The dev server's config extraction crashes on Node 22 because `@netlify/serverless-functions-api` (nested inside `@netlify/zip-it-and-ship-it`) assigns `globalThis.caches`, a getter-only property in the config-extraction sandbox. A guarded `try{Tg()}catch(e){}` patch is applied in node_modules; re-apply it after any dependency reinstall or the preview fails to start.
