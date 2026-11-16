# Course color exhaustion fix

`assignDotIndices` previously searched the 12-slot hue palette until it found an unused slot. Once all 12 hues were used, later courses kept searching forever and blocked the UI thread. The allocation loop now probes at most 12 slots; after palette exhaustion it assigns the next deterministic hue, reusing colors while retaining all valid saved indices and the original first 12 assignments.

The regression runs the actual allocator function in an isolated worker with a 500 ms termination deadline. It covers the minimal 13-course exhaustion case as part of 65 courses, repeated calls, reversed order with saved assignments, and a fully occupied saved palette.
