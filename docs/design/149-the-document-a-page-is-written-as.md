# 149: The document a page is written as

## Decision

`site.page(url)` answers one finished HTML document, built from the shell the bundler produced and
the render of that URL. Four things happen to the shell, and nothing else does:

1. **The head run goes at the front of `<head>`**, behind a leading `<meta charset>` when the shell
   wrote one as the head's first child, exactly where a mount puts it (design 127). The run is
   `<style data-aweft>` holding `theme.markup()`, then `head.markup()`.
2. **The shell's own `<title>` is removed** when the page declares one. Design 127 leaves it behind
   the page's title in a live document because a mount cannot safely delete what it did not write;
   a generated file has no such caller, and a second title in the markup is a title a crawler may
   read.
3. **The body markup goes inside `<body>`**, and the body tag gains `data-aweft-ssg`.
4. **Nothing else is parsed.** The shell is read as text: the `<head>` open tag, an optional
   leading charset, an optional `<title>`, and the `<body ...>` open tag. A shell with no `<head>`
   or no `<body>` is refused by name.

A shell whose `<body>` already holds markup is refused too. The page's markup is the body's
content, and a hydration into the body treats anything else there as markup the client did not
render. A bundler puts its module script in the head, which is where it has to stay.

`shell.html` is the shell as it was, with no stamp, no markup and no head run. `attach` finds no
stamp on it and mounts live.

## Why

The stamp is on `<body>` because the body is what an application hands `attach`, and a page has to
be able to say whether it was rendered or is empty without guessing from its contents. An empty
body is not proof of anything: a page whose root component renders nothing looks the same.

A string operation rather than a parser, because a document a bundler wrote is not arbitrary HTML
and the four positions above are all this needs. Parsing the shell would mean serializing it
again, which means deciding how to write every tag in it, and a build tool that rewrites the
bundler's output in ways nobody asked for is a build tool people fight.

Refusing rather than working around a body with content, because the alternative silently produces
a page that asserts in the browser on the first hydration, and the fix is one line in the shell.

## What this costs

An application whose shell deliberately holds a loading skeleton in the body cannot use the
generated document. It moves the skeleton into the component, which is where a hydration can adopt
it anyway.

Removing the shell's title means a shell title is only ever the fallback for a page that declares
none, which is what a shell title is for.

## What would reverse this

A page shell that has to keep body content the page renders around rather than replaces, which
would need the mount target to be an element inside the body rather than the body itself, and a
stamp on that element instead.
