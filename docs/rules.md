# Rules of Grainbox

## Applying

1. Any time you see `()` on a proxy, semantically, it means "unbox". This is also called an empty apply operation. It calls the apply trap with no arguments.
2. If you see `(arg)` on a proxy, where `arg` is not a function, this is actually a set operation. It calls the apply trap, but forwards the argument to the set trap.
3. If you see `(() => ())` on a proxy, the argument is a function, and therefore, this is a special apply operation. This is used to pass special values or commands to the proxy to get it to do special things.

## Components

1. All components should take in a single `props` argument.
2. All properties of the `props` argument are proxies. You should unbox them before using them.
3. Reactive components do not propagate an update signal up to listers. This is to prevent the entire DOM from recomputing when a leaf changes.

## j

1. Top-level calls to `j` must be deterministic.