# Third-party references and optional dependencies

The original source code in this repository is licensed under MIT.
No external book corpus, purchased text, personal case database, generated
third-party interpretation dataset, package binary or model weight is included.

## Calendar and time references

The reference provider uses Node.js Intl/ICU for calendar and time-zone support.
Those components are distributed with the user's Node.js runtime under their
own applicable licenses; this repository does not redistribute the runtime.

Solar-position and solar-time formula references include Jean Meeus,
*Astronomical Algorithms*, and NOAA's solar-calculator documentation.
See `capabilities/SOURCES.md` for references, approximation limits and the
distinction between technical references and traditional terminology sources.
An algorithm reference does not imply endorsement or an accuracy certification.

Classical source identifiers and short historical terminology references are
retained as provenance pointers. Full transcriptions and local purchased
editions are not redistributed; a pointer is not permission to redistribute
the linked or locally held material.

## Optional Python/GPU OCR

`agent-tools/ocr/requirements.lock.txt` lists separately installed Python
dependencies. Those packages retain their own licenses. Installing optional
packages or models may require separately accepting their terms. Their
environments, binaries, models and caches are excluded from this repository.

## Optional model providers

The Agent Room code is a client adapter. It does not include API credentials,
account configuration, service access rights or a license to model outputs.
Users configure their own provider and are responsible for its applicable terms.
