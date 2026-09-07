# recipes/posts-to-pages

A small publication whose pages are written while it is running. Someone publishes a post over a
socket, the module that takes it puts the row in the store and writes that one page, and the page
is live before the call has answered.

## What the gate does with it

```
AWEFT_DEFAULT_H=@aweftjs/ui node --import @aweftjs/build/loader recipes/posts-to-pages/main.ts
```

It exits nonzero when any assertion fails. Four passes.

**A backend with a store in it.** `createStore` over `memoryDriver`, one document called `posts`
with an array root, and a server with `gate: open` on a port the operating system picks. One
module, `posts/Publish`, is handed the posts array and the site in its props.

**Publishing.** A client opens a socket and asks `posts/Publish` for a post. The module pushes the
row, writes the rows out as `posts.json`, and calls `site.write(['/posts/first-light'])`. It answers
the files it wrote, and the run asserts that it wrote exactly one: the page has the post's title in
its head and its body in the markup, it is stamped, and there is still no `sitemap.xml`, because a
list writes those pages and nothing else.

**The page in a browser.** The directory is served with `node:http` and Chromium loads
`/posts/first-light`. The page hydrates with nothing thrown in the console, which is the assertion
that matters: the markup the server wrote and the tree the client builds agree.

**The scheduled refresh.** `createScheduler` over a job that runs hourly, with a clock the run
drives rather than a clock it waits for. One hour later the job has run once, `site.write()` has
walked the whole site, and `sitemap.xml` now lists the published post and leaves out the page whose
head says `robots noindex`. The `404.html` and the live `shell.html` arrive with the same write.

## How the browser gets the data

The site component takes the posts as a prop. It does not go and fetch them, because a component
that waits on the server waits again on the client and renders its loading state over the finished
page. The build hands it the rows in the store; `entry.tsx` reads the same rows out of
`posts.json`, which the module wrote beside the pages, and only then calls `attach`. So the client
renders what the server rendered and the hydration finds the two agreeing.

`entries()` is the other half of the same idea, and it is server-side only: which posts exist is a
question only the store can answer, so the act answers it from the rows.

## What it does not do for you

**It does not keep the sitemap current between full writes.** A post published at noon is live at
noon and in the sitemap after the next full write. That is the trade `write(urls)` exists for: a
write inside a request cannot render every page the site has.

**It does not check that a URL names a real row.** `ssg` refuses a URL the site's routing does not
match, but `posts/:id` matches any id, so a slug with a typo in it is a page as far as the routing
is concerned and the act decides what to show. The module checks the row is in the store before it
writes, which is the half only the application can do.

**It does not decide who may publish.** The module is `public: true` because this recipe has no
accounts in it. A real one puts `auth`'s gate in front of the server and takes the flag off.

**It does not serve the files.** `server`'s routes are exact, so a directory would be a route per
file. The twenty-line `node:http` server here is what a real host replaces.

**It does not tell the browser that a page changed.** A reader with the old page open keeps it. A
publication that needs the page to update in front of a reader shares the document over the socket
instead, which is what `recipes/todo-list` and `recipes/two-clients` show.

**It writes `posts.json` itself.** `ssg` writes pages, a 404, a shell and a sitemap. Any other file
the client needs is the application's to write, which is why the module writes this one.
