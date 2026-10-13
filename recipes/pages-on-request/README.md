# recipes/pages-on-request

A small publication whose pages are rendered when they are asked for. A crawler gets each post in
the markup, at the status that says what the URL is. A person gets a page that is live at once,
and the browser does not ask the server again for what the page was rendered from.

## What the gate does with it

```
AWEFT_DEFAULT_H=@aweftjs/ui node --import @aweftjs/build/loader recipes/pages-on-request/main.ts
```

It exits nonzero when any assertion fails. Three passes.

**One server, nothing written but the bundle.** vite builds `entry.tsx` into `dist`, and a server
loads `modules/`:

- two read modules, `posts/List` and `posts/Read`
- `site/Pages`, which is `createPages` from `@aweftjs/ssg` handed those two and the gate
- `site/Calls`, which writes down every ask that reaches the server over a socket
- a file that points `static/Files` at `dist`, so the bundle is served for the paths the pages
  module declines

**What a crawler is answered.** `/` is 200 with every post's link in the markup and the answers it
was rendered from in the head, read once. `/posts/second-wind` is the post. `/posts/third-time` is
404, because the post page wrote `<Meta httpEquiv="status" content="404" />` when the read refused.
`/nowhere` and `/posts/first-light/extra` are 404 with the site's not-found page: the stage is
`exact`, so a key that only starts a path does not take it.

**A person opening a post.** Chromium loads `/posts/first-light` and waits for the hydration. The
server read the post once, for the render, and no ask reached it over the socket while the browser
took the page over. No element the server wrote was removed or replaced, every element's box is
where it was before the bundle ran, and Chromium reported no layout shift. A click on "All posts"
then reads the list over the socket, once: the answers were for the hydration and are gone.

## How the browser gets the data

`entry.tsx` is three lines. `replay(createClient())` is a client that answers each ask from the
answers the server wrote into the page before it asks the server, and `attach` hydrates. Each act
reads through `suspend`, and each loader answers a component call with what it read as props:
`<Article post={await client.ask(...)} />`. That is what lets the hydration keep the server's
markup and adopt it. An element built inside the loader is built outside the mount, and it replaces
the server's element rather than adopting it.

## What it does not do for you

**It caches nothing.** Every request renders. A cache in front of the process is yours, and so is
deciding how long a page may be stale.

**It renders as nobody.** A signed-in visitor gets the page anyone gets. Whatever is theirs loads
after the page is live, through the same client.

**It writes no sitemap.** `site.write()` at build time or on a schedule still does that, as
`recipes/posts-to-pages` shows.

**It renders one language.**
