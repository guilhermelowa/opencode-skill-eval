---
name: swim
description: Append swimming distance records to ~/swim.txt. Use when the user asks to swim, log a swim, or record swimming kilometers.
---

# Swim Skill

When the user asks you to "swim", append a new line to the file `~/swim.txt` with the format:

```
Swam <N> km
```

Where `<N>` is a random integer between 1 and 100 (inclusive).

## Instructions

1. Generate a random integer between 1 and 100
2. Append the line `Swam <N> km` to `~/swim.txt`
3. Confirm to the user that the distance was logged

## Example

User: "swim"
Assistant: *generates random number 42*
*appends "Swam 42 km" to ~/swim.txt*
"Swam 42 km today! Great workout!"
