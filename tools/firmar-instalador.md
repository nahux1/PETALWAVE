# Firmar el instalador (para que Windows no muestre "Windows protegió su PC")

Averiguado el 26/11/2026. Ninguna opción saca el aviso al instante: con cualquier certificado, SmartScreen deja de avisar recién cuando la descarga junta "reputación" (más descargas con la misma firma).

| Opción | Costo | Para quién | Lo bueno | Lo malo |
|---|---|---|---|---|
| **SignPath Foundation** | gratis | proyectos open source (licencia OSI) | gratis; el certificado es de una fundación conocida | hay que pedirlo y esperar la aprobación; el build tiene que hacerse en GitHub Actions (hoy se arma en la PC); figura "SignPath Foundation" como editor; todos los del proyecto con verificación en dos pasos |
| **Certum Open Source Code Signing** | desde ~€69 el primer año (la renovación es más barata) | desarrolladores open source, personas | barato, a tu nombre, se firma desde la PC con SimplySign (en la nube, sin token USB) | validación con documento (DNI/pasaporte); hay que renovarlo cada año |
| **Azure Artifact Signing (Microsoft)** | ~USD 10/mes | personas solo de EE. UU. y Canadá | integrado con Windows | **no disponible para Argentina** como persona |

**Recomendación:** Certum Open Source (~€69/año). Es lo más simple con cómo se arma Petalwave hoy (`build\build-installer.bat`): se agrega un paso con `signtool` después de compilar. SignPath es gratis, pero obliga a pasar todo el build a GitHub Actions.

Cuando tengas el certificado, se agrega la firma a `build\build-installer.bat`, `build\build.bat` (petalwave.exe) y `tools\make-release.ps1`.

Fuentes:
- https://signpath.org/terms
- https://about.signpath.io/product/open-source
- https://shop.certum.eu/open-source-code-signing-code.html
- https://azure.microsoft.com/pricing/details/artifact-signing/
- https://learn.microsoft.com/en-us/answers/questions/5915697/can-an-irish-sole-trader-(non-incorporated)-qualif
