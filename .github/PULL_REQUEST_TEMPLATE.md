<!--
  Adding a showcase demo? Fill the "Contributor" section only.
  Leave "Maintainer review" for whoever reviews the PR.
  See CONTRIBUTING.md for the full guide and the rules behind each checkbox.
-->

## Summary

- Demo id / title:
- One-line summary:
- Author (display name) / author URL:

## Contributor checklist

- [ ] Reference image rights: (own photo / public domain / licensed — name the source)
- [ ] Generated via the img2threejs skill (version: )
- [ ] `npm run build` passes locally
- [ ] Screenshot of the rendered demo attached below
- [ ] Only touched `src/demos/<id>/`, `public/references/<id>.<ext>`, and appended to `src/demos/registry.ts`
- [ ] New `registry.ts` entry has every `DemoEntry` field filled and `status: 'final'`

## Screenshot

<!-- paste here -->

---

## Maintainer review (do not fill as contributor)

- [ ] Visual fidelity acceptable against the reference image
- [ ] License/rights statement plausible; no PII or trademark-as-primary-subject issue
- [ ] `status: 'final'` (not left as `'placeholder'`)
- [ ] Bundle size delta looks sane
- [ ] `pr-safety-check` is green
