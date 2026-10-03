# Research notes and primary references

These links are research inputs, not dependencies.

## MeOS

- Main feature description: https://www.melin.nu/meos/en/features.php
- Documentation: https://www.melin.nu/meos/en/show.php
- Development protocols/resources: https://www.melin.nu/meos/en/codes.php
- Source repository and AGPL license: https://github.com/melinsoftware/meos
- Current downloads and supported SI cards: https://www.melin.nu/meos/en/download.php

Observed relevant capabilities include direct SPORTident serial communication, card readout, direct entry, start draw, forest control, relays, patrol, rogaining, speaker views, online protocols, backups, result revisions/rules and multi-client operation.

## SPORTident

- Documentation portal: https://docs.sportident.com/
- Config+ and direct USB station connection: https://docs.sportident.com/user-guide/config-plus
- Live data overview: https://docs.sportident.com/user-guide/live-data

Official documentation confirms direct USB readout stations and Android/desktop capture products. A stable public developer SDK/protocol contract should be verified directly with SPORTident before assuming undocumented commands will remain stable.

## IOF data standard

- IOF XML 3.0: https://orienteering.sport/iof/it/data-standard-3-0/

## Eventor

- API documentation: https://eventor.orientering.se/api/documentation
- About Eventor, terms and privacy: https://eventor.orientering.se/Home/About
- Test environment information: https://eventor.orientering.se/Home/HelpAndSupport

Eventor exposes IOF XML and API methods for entries, competitors, starts and results. Access to personal information can require a data-processing agreement with the Swedish Orienteering Federation.

## Livelox, only for independent feature research

- Viewer documentation: https://www.livelox.com/Documentation/Viewer
- Maps: https://www.livelox.com/Documentation/EventOrganisers/Maps
- Courses: https://www.livelox.com/Documentation/EventOrganisers/Courses
- API terms: https://www.livelox.com/Documentation/Api
- FAQ and feature boundaries: https://www.livelox.com/Documentation/Faq

The public API terms state that API users must not replicate or directly compete with Livelox, and maps/routes are not exposed. O-Tid must therefore use its own data pipeline.

## Android serial transport

- usb-serial-for-android: https://github.com/mik3y/usb-serial-for-android

This can be evaluated as a raw Android USB serial transport. The project should still own the SPORTident framing and card protocol layer.

## Codex

- Codex overview: https://openai.com/codex/
- Project instructions and AGENTS.md guidance: https://help.openai.com/sv-se/articles/11369540
