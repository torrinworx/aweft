# 067: A capability is a granted name, and the grants are an observable list

## Decision

`createSandbox({ grants })` takes an observable array of names the application made with
`createArray` and changes whenever it likes. `sandbox.expose(name, instance)` puts a trusted
instance behind a name and returns the function that withdraws it. Inside the room, a name
that is both granted and exposed is a module a sandboxed module can name in `deps`; its
import is a plain object carrying one function per function the instance had, and calling
one is a call row (design 068). The function names ride on the `room` document, so the
import is an ordinary object and never a `Proxy`.

The host checks the grant on every call, against its own list: a name removed from `grants`
refuses from the next call with reason `refused`. A name granted but not exposed is `missing`
to a `load`. A granted name is listed ahead of the module document, so a room cannot shadow a
grant with a module of the same name.

Modules inside one room use `deps` among themselves exactly as in a single process, and may
trust each other. Which modules share a room, one per user, one per call, or one for all, is
the application's, as is who changes the list and why.

## Why

A sandbox holds a list of the modules it may interact with, and that observable array changes
on whatever the application decides: a user's payment, a user's plan. The package defines only
the shapes that let an application define the sandbox's authority safely. The list is the dial
the application turns; the package turns nothing.

An import that is a plain object with known functions, rather than a catch-all, is what
keeps `await imports.Thing` from calling a `then` that does not exist, and what lets a module
see what it was handed.

## What it costs

Only functions cross. A property on an exposed instance that is not a function is not
visible inside the room; expose a function that returns it. Adding a function to an instance
after it was exposed does not reach a room until it is exposed again.

## What would reverse this

An application needing a grant finer than a name (one function of an instance, one argument
shape). The design for that would sit above this one, in the application or in `server`.
