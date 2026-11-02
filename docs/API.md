# Command API

All browser routes are under /api and share one origin. POST /auth/login accepts email/password and sets an HttpOnly session cookie. GET /auth/me returns the current user and CSRF token. All session mutations require X-CSRF-Token. GET /state is company-scoped and bounded; query page/pageSize/search for cartons. GET /cartons/{id}/history returns scoped audit history. GET /documents/shipment/{id} returns the authoritative packing-list data.

POST /commands:

```json
{"requestId":"client-created-UUID","type":"scan","data":{"sessionId":"...","station":"LOADING-PC-01","qr":"K1|demo|CT-...|1","mode":"live"}}
```

Keep the same requestId **and exact body** after an uncertain response. GET /requests/{id} returns only the current actor's saved outcome. A 404 is still ambiguous while an earlier request could be in flight. Retrying the exact envelope is safe for this transactional cloud API. It is not a guarantee of exactly-once execution in Tally.

New standard carton labels encode `Q<14-character base64url identity>.<uppercase base36 revision>`. For example, `CT-0123456789ABCDEF0123`, revision 1, becomes `QASNFZ4mrze8BIw.1` (17 characters). All 80 identity bits are preserved. Decoding requires canonical encoding and a positive Int32 revision. Resolution still loads the carton in the authenticated company scope and rejects obsolete revisions. Existing `K1|company|id|revision` labels remain valid; nonstandard fixture IDs retain that format. No stored IDs or database schema change.

| Type | Required data | Role |
|---|---|---|
| saveManifest / importManifest | name, warehouseId, optional customerId, notes, groups; id/version when editing | PackingClerk / PackingSupervisor |
| deleteManifest | id, version, reason, confirmed=true; only unused cartons with no allocation history | PackingSupervisor |
| deleteTrip | id, reason, confirmed=true; only empty, undeparted trips | DispatchSupervisor |
| deleteShipment | id, reason, confirmed=true; unload first, no load approval, invoice jobs or returns | DispatchSupervisor |
| approveManifest | id, physicalConfirmed=true | PackingSupervisor |
| createLabels | ids[], reason | PackingClerk / PackingSupervisor |
| labelStatus | id, state, reason | PackingClerk / PackingSupervisor |
| attachLabels | ids[], physicalConfirmed=true, contentsConfirmed=true, revisions[{id,revision}] | PackingSupervisor |
| verifyCarton | Retired; returns 400 directing the operator to the one-scan workflow | No writes |
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
| pairConnector | name, expectedCompany | Admin |
| revokeConnector | id, reason | Admin |
| createUser | name, email, password (12+), roles[] | Admin |

Admin may perform any role operation. MD may read but cannot mutate. A group is {marking,count,lines:[{sku,quantity,unit}]}; a mixed group has several lines. Decimal JSON values may be numbers or invariant decimal strings. SKU is always a string. Batch/godown extensions remain explicitly blocked until mapped.

Print states: Prepared, Submitted, Failed, Unknown, OperatorConfirmed. Return dispositions: Quarantine, Disposal, AwaitingAccountingRestock. Only the original carton IDs/revisions are reprinted. No generic endpoint permits setting a posting job to Confirmed.

Connector routes require X-Connector-Id and X-Connector-Key; no browser cookie. POST /connector/heartbeat requires the exact company, environment=Production, tallyReachable, version and detail. POST /connector/masters updates linked native items and customer ledgers from the latest exact-company snapshot. Unknown Tally masters are not automatically created. Electro's connector can queue production invoice jobs only after the mapping is validated; it imports the voucher and confirms it through exact-reference readback before the driver-document gate opens.

POST /maintenance/outbox requires Admin and CSRF. It marks a bounded audit-feed polling batch delivered, not delivery to a printer or Tally.

## Related work views

GET /api/work/{kind}/{id}?page=0 accepts kind packing, trip or shipment. It requires a valid session and verifies the record belongs to that company; unknown or other-company records return 404 and unsupported kinds return 400. It returns related cartons (500 per page), cartonTotal/hasMore, manifests, trips, shipments, allocations, billings, jobs, returns, labels and audit. The UI merges authoritative details by ID before applying a display filter; it retains full loaded inventory for reservation and complete loaded shipment details for pricing. No command, approval, tenant permission or Tally posting policy is weakened by the view.
# Workflow selection and orders

`GET /api/state?workflow=StockFirst` and `GET /api/state?workflow=OrderFirst` select the operational workflow. `/api/work/{kind}/{id}` accepts the same workflow query parameter and rejects a record from the other workflow. Omission defaults to StockFirst for existing clients. Shared master/accounting settings are included in both responses. State includes `orders` and aggregate `orderProgress` (packed and actively assigned carton counts), independent of the paginated carton window.

The UI sends `data.workflow` in every command, including the recoverable scanner envelope. New manifests and vehicle trips persist that workflow. OrderFirst manifests and shipments require an order link; selection and mutation checks prevent mixing workflow records. Legacy clients without a workflow retain their previous StockFirst behavior.

`createOrder`: `{workflow, reference, customerId, warehouseId, destination, expectedCartons, lines, notes}`. `lines` is an optional empty array or positive SKU/quantity/unit totals for the entire order. The role must be Admin, DispatchSupervisor, PackingSupervisor or Billing. References are unique per company/workflow.

`deleteOrder`: `{workflow, id, reason, confirmed:true}`. Only Admin/DispatchSupervisor can delete an order without any packing or shipment history.

`saveManifest` / `importManifest` accept `orderId`. OrderFirst requires it and validates customer/warehouse and order limits; explicit StockFirst packing starts as general stock. `allocate` accepts `orderId` and checks the order's remaining carton/product requirements. OrderFirst additionally requires all cartons to originate from the exact order's packing lists.
