# Command API

All browser routes are under /api and share one origin. POST /auth/login accepts email/password and sets an HttpOnly session cookie. GET /auth/me returns the current user and CSRF token. All session mutations require X-CSRF-Token. GET /state is company-scoped and bounded; query page/pageSize/search for cartons. GET /cartons/{id}/history returns scoped audit history. GET /documents/shipment/{id} returns the authoritative packing-list data.

POST /commands:

```json
{"requestId":"client-created-UUID","type":"scan","data":{"sessionId":"...","station":"LOADING-PC-01","qr":"K1|demo|CT-...|1","mode":"live"}}
```

Keep the same requestId **and exact body** after an uncertain response. GET /requests/{id} returns only the current actor's saved outcome. A 404 is still ambiguous while an earlier request could be in flight. Retrying the exact envelope is safe for this transactional cloud API. It is not a guarantee of exactly-once execution in Tally.

| Type | Required data | Role |
|---|---|---|
| saveManifest / importManifest | name, warehouseId, optional customerId, notes, groups; id/version when editing | PackingClerk / PackingSupervisor |
| approveManifest | id, physicalConfirmed=true | PackingSupervisor |
| createLabels | ids[], reason | PackingClerk / PackingSupervisor |
| labelStatus | id, state, reason | PackingClerk / PackingSupervisor |
| attachLabels | ids[], physicalConfirmed=true | PackingClerk / PackingSupervisor |
| verifyCarton | qr, physicalConfirmed=true | PackingSupervisor |
| holdCarton | id, held, reason | PackingSupervisor / DispatchSupervisor |
| reviseCarton | id, lines[], reason | PackingSupervisor |
| repack | id, groups[], physicalConfirmed=true, reason | PackingSupervisor |
| createTrip | vehicle, driver, transporter | DispatchSupervisor |
| updateTrip | id, vehicle, driver, reason | DispatchSupervisor |
| allocate | tripId, customerId, destination, ids[] | DispatchSupervisor |
| startLoading | shipmentId, station | Loader / DispatchSupervisor |
| scan | sessionId, station, qr, mode=live | Loader / DispatchSupervisor |
| unload | id (carton), shipmentId, reason | DispatchSupervisor |
| releaseShipment | id, reason | DispatchSupervisor |
| approveLoad | id (shipment), physicalConfirmed=true | DispatchSupervisor |
| saveBilling | shipmentId, rates[{sku,rate,discountPercent}], freight, otherCharges, reason, terms, version | Billing |
| approveBilling | id (billing revision), physicalConfirmed=true | Billing |
| queueInvoice | id (shipment) | Billing; creates Blocked job only |
| recordDocuments | id (shipment), print, statutoryReference, reason | Billing / DispatchSupervisor; confirmed voucher required |
| depart | id (trip), physicalConfirmed=true | DispatchSupervisor |
| recordReturn | id (original carton), shipmentId, lines[], reason, condition | DispatchSupervisor |
| returnDisposition | id (return), disposition, reason | PackingSupervisor |
| saveMapping | expectedCompany, tallyVersion, salesLedger, voucherType, notes, statutoryRequired, reason | Billing |
| saveProduct | sku, name, unit, optional tallyId/tallyName, reason | Billing |
| saveCustomer | optional id, name, address, optional tallyId/gstIn, reason | Billing |
| saveConversion | productId, fromUnit, factor, reason | Billing |
| pairConnector | name, expectedCompany (test only) | Admin |
| revokeConnector | id, reason | Admin |
| createUser | name, email, password (12+), roles[] | Admin |

Admin may perform any role operation. MD may read but cannot mutate. A group is {marking,count,lines:[{sku,quantity,unit}]}; a mixed group has several lines. Decimal JSON values may be numbers or invariant decimal strings. SKU is always a string. Batch/godown extensions remain explicitly blocked until mapped.

Print states: Prepared, Submitted, Failed, Unknown, OperatorConfirmed. Return dispositions: Quarantine, Disposal, AwaitingAccountingRestock. Only the original carton IDs/revisions are reprinted. No generic endpoint permits setting a posting job to Confirmed.

Connector routes require X-Connector-Id and X-Connector-Key; no browser cookie. POST /connector/heartbeat requires company, environment=Test, tallyReachable, version, detail. POST /connector/masters updates already-linked native item IDs only, at most 500 items [{nativeId,name,unit,balance}], with exact company/environment. Unknown Tally masters are not automatically created. GET /connector/jobs/next returns 409 Blocked in this stage.

POST /maintenance/outbox requires Admin and CSRF. It marks a bounded audit-feed polling batch delivered, not delivery to a printer or Tally.
