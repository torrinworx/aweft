# 308: The types say what a call takes

## Decision

These types change. Nothing at run time does.

- **`Cell<T>`** is exported from `core`. It is the type `mutable` returns, the same type as
  `Derived<T>`, under the name every README uses. `core` had an internal type of that name for what
  a slot holds. It is now `SlotCell`.
- **`each`** is typed from the item. A component that declares `each: Item` takes `each={items}`
  where `items` is an `Iterable<Item>` or a cell that holds one. Those are the lists `dom` mounts:
  an array, a document array, a list cell, a `Set`. A scope from `observer` has its value typed
  `unknown`, so it is taken with no item type. A list of anything else is a type error.
- One item is taken as well. Code written against the old type cast its list to the item to compile
  (`each={rows as unknown as Row}`), and that code keeps compiling. The runtime still refuses an item
  that is not a list.
- `dom` exports the mapping as `CallProps<P>`. JSX reads it through `JSX.LibraryManagedAttributes`
  in `ui`'s JSX types, and `h` reads it through its own signature.
- **`h`** with a component as its tag checks the props against the component's own props, with
  `each` read as above and `children` free. A component whose props are `unknown`, or that takes
  none, takes any. With an element name, a node or a mark as its tag it takes any record, as
  before. `dom`'s `h` and `ui`'s `h` and `svg` have the same two signatures. The component tag is
  `ComponentTag<P>`, written as a method so a generic component, whose props TypeScript cannot pin
  down from the tag alone, is still taken, its props then unchecked as before. JSX still lets an
  attribute a component does not declare through, as `JSX.IntrinsicAttributes` always has. A
  direct `h` call refuses one, as TypeScript does any object literal. `h(Component)` with no props,
  or `null`, is not checked, as JSX's `<Component />` is.
- **`H`**, the `h` that `htm` takes, is written as a method too, so the typed `h` of either package
  is still one `htm` takes.
- **`ui`'s `Component`** is written as a method, so a component that declares props of its own is
  taken where any `Component` is: a prop typed `Component` takes an act that declares `stage`.
- **An act** may declare the props the stage hands it. `stage` is checked as `StageValue`. Any other
  prop it declares (`refusal`, `retry`, what an `open` passes) is its own business, because what an
  `open` passes is decided at run time. `ActProps` is what every act is handed, and `ActBody` is the
  shape of an act's body. The `component` an act module answers is typed the same way.

## Why

Every README says "cell", and the type a component's prop takes was learnable only from the
source, where it is called `Derived`. Applications wrote their own (`type Cell = { get(): unknown,
set(value: unknown): void }`), or `ReturnType<typeof mutable<boolean>>`. A second name for one type
costs a line. Not finding the first one cost every application a cast.

`each` is the list at the call site and one item in the body. The component type said
`each?: unknown`. So a row component that typed its item was refused at the call site, because
`Item[]` is not `Item`. Applications did one of two things. Some typed the item `unknown` and cast
it back in the body (`props.each as Grant`, once per row component). Others cast the list to the
item at the call site (`each={rows as unknown as Row}`). TypeScript gives a JSX library
`LibraryManagedAttributes` for this case, where a call site writes different props from the ones
the component declares.

`h` took `Record<string, unknown>` whatever the tag was, so a misspelled prop passed and an inline
callback was an implicit `any` under `strict`. JSX already checks a component's props, and a
direct `h` call now does too.

An act was typed as a component of `Record<string, unknown>`. An act that declared the `stage`
prop, which the README's own example reads, was refused. The act type is now written as a method.
TypeScript compares a method's parameter in both directions. So an act may declare props beyond
`stage` that the stage does not promise, and a `stage` of the wrong type is still refused.

## What this costs

Three shapes that typechecked before now fail, each at the line that writes it:

- A direct `h(Component, props)` whose props the component does not declare, or of the wrong
  type. That is the point of the change.
- A tag typed `unknown`, such as a component's own `element` prop. It needs a cast to the tag it is
  (`as string | NodeLike`), because a tag of any type would let a component through unchecked.
- An `each` given a chain whose value is typed `unknown` (`observer(doc).path('items').map(...)`
  with an untyped callback), because a cell of the wrong item would then pass too. Typing the value
  in the callback is the fix.

The evidence below says how often each happens in the applications that exist. A call written with
`as never` on the tag keeps compiling as before.

The types could refuse two more shapes, and they do not, so that code which compiles today still
compiles. One is a single item where a list goes. The other is a component with props of its own
where any component goes. Applications wrote both to get past the old types, and the runtime takes
both as before.

## Evidence

- The root typecheck reads the cases in `packages/ui/tests/fixtures/typed.tsx` (JSX, `h`, acts,
  `Cell`) and `packages/dom/tests/types.test.ts` (`h`, `CallProps`). Each refusal there carries
  `@ts-expect-error`, so a refusal that stops happening is itself a type error.
- The accepted calls run in `packages/ui/tests/types.test.ts` and `packages/dom/tests/types.test.ts`.
  A type that takes a shape the runtime refuses would fail there.
- A generic component through `h`, and an act typed by an interface that extends `ActProps`, are
  accepted cases in the same files.
- The stack's own sources, tests and recipes typecheck under the new types. They needed a cast in
  three places: where a tag was `unknown` (a component's `element` prop), where a test hands a wrong
  prop on purpose to check a refusal, and in one `dom` test that gave a row declaring `string` a list
  typed `unknown[]`. That last type error was right.
- The five applications built on the stack were typechecked, unchanged, against these types and
  against the stack before them. Both runs: 0 errors in all five.
- A first version refused one item where a list goes, and kept `Component` one-way. It gave one
  application 3 errors: its two `each={list as unknown as Item}` casts, and a test that handed an
  act declaring `stage` to a prop typed `Component`. That is why the two shapes are taken now.

## What would reverse this

An application needs a shape that the runtime takes and the types refuse. Then that shape goes
into the tests above as a case, and the type widens to take it.
