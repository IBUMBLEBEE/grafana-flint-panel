# Security policy

## Supported versions

Security fixes are provided for the latest published version of Flint Panel.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's **Security advisories** page for this repository. Do not open a public issue for an undisclosed vulnerability.

Include the affected version, reproduction steps, impact, and any suggested mitigation. You should receive an acknowledgement within seven days.

## Credential handling

Flint Panel does not accept or persist provider credentials. Optional AI credentials belong to the configured datasource and must be stored by Grafana in `secureJsonData`. Never include API keys in dashboards, panel options, issues, screenshots, or test fixtures.
