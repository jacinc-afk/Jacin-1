# Rotation state

`rotation.json` records whose turn it is in each rotating department. Today
that is reroof only — repairs always go to Alex and warranties always to Jacin,
so neither has a pointer.

The number is an index into the department's people list in
`src/departments.js`. For reroof that list is:

    0  Jacin Carreiro
    1  Francis Ferrer
    2  Alex Patapis

It advances by exactly one when a lead is assigned, and at no other time. A
lead that gets flagged for a human decision does not consume a turn, and a lead
that is assigned and later dies does not give one back.

Edit it by hand whenever that is the right answer — someone goes on holiday,
the rotation gets out of step, a person joins or leaves. Nothing here is
sacred, and getting it wrong costs one person one extra lead.
