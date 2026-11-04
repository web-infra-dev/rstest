import { HL } from './kernel.js';

/**
 * Stack: three browser windows lying one on another with no gap, one per
 * engine, each with its logo on its bar. The pointer's height picks an engine.
 * The page on top folds flat, the bottom window fades out where it lies and comes
 * back down from above the frame onto the top while the others step down, until the
 * picked one is on top; only then does its page come apart: every
 * element lifts off its parent as a thin plate, each to its own height, an
 * exploded view of the DOM. The slider is the gap.
 */
const {
  Cam,
  clamp,
  extremes,
  facing,
  fit,
  open,
  poly,
  prism,
  proj,
  ringAt,
  rings,
  rrect,
  seg,
  spring,
  stepS,
  tset,
  tval,
  tdone,
  tween,
  disposer,
  mk,
  place,
  pointer,
  put,
  register,
  solid,
  fade,
} = HL;

// The window: x runs right, y runs down the page, the bar along the top edge (y = 0).
const WX = 170,
  WY = 146,
  BAR = 30,
  TK = 6,
  GAP = 6,
  PT = 1.4;
// One turn of the stack: the bottom window fades out where it lies in SINK ms, comes back from RISE above the top, out of the frame, and settles in
// SETTLE ms; the others step down one slot each, LAG ms after it starts fading, STAG ms apart, in SHIFT ms.
const RISE = 220,
  SINK = 500,
  SETTLE = 1000,
  SHIFT = 700,
  LAG = 300,
  STAG = 100;
// The levels a leaving window fades through. This is an opacity trick, against rule 04 on purpose: the homepage asked for it.
const SHADES = 16;
// The engines' own logos, the official SVGs from alrra/browser-logos (MIT), in colour. This breaks rules 04 and 10 on purpose: the homepage asked for them.
const LOGOS = [
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9Ii0xMCAtMTAgMjc2IDI3NiI+PGxpbmVhckdyYWRpZW50IGlkPSJhIiB4MT0iMTQ1IiB4Mj0iMzQiIHkxPSIyNTMiIHkyPSI2MSIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPjxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iIzFlOGUzZSIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzM0YTg1MyIvPjwvbGluZWFyR3JhZGllbnQ+PGxpbmVhckdyYWRpZW50IGlkPSJiIiB4MT0iMTExIiB4Mj0iMjIyIiB5MT0iMjU0IiB5Mj0iNjIiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNmY2M5MzQiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNmYmJjMDQiLz48L2xpbmVhckdyYWRpZW50PjxsaW5lYXJHcmFkaWVudCBpZD0iYyIgeDE9IjE3IiB4Mj0iMjM5IiB5MT0iODAiIHkyPSI4MCIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPjxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iI2Q5MzAyNSIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI2VhNDMzNSIvPjwvbGluZWFyR3JhZGllbnQ+PGNpcmNsZSBjeD0iMTI4IiBjeT0iMTI4IiByPSI2NCIgZmlsbD0iI2ZmZiIvPjxwYXRoIGZpbGw9InVybCgjYSkiIGQ9Ik05NiAxODMuNEE2My43IDYzLjcgMCAwIDEgNzIuNiAxNjBMMTcuMiA2NEExMjggMTI4IDAgMCAwIDEyOCAyNTZsNTUuNC05NkE2NCA2NCAwIDAgMSA5NiAxODMuNFoiLz48cGF0aCBmaWxsPSJ1cmwoI2IpIiBkPSJNMTkyIDEyOGE2My43IDYzLjcgMCAwIDEtOC42IDMyTDEyOCAyNTZBMTI4IDEyOCAwIDAgMCAyMzguOSA2NGgtMTExYTY0IDY0IDAgMCAxIDY0IDY0WiIvPjxjaXJjbGUgY3g9IjEyOCIgY3k9IjEyOCIgcj0iNTIiIGZpbGw9IiMxYTczZTgiLz48cGF0aCBmaWxsPSJ1cmwoI2MpIiBkPSJNOTYgNzIuNmE2My43IDYzLjcgMCAwIDEgMzItOC42aDExMC44YTEyOCAxMjggMCAwIDAtMjIxLjcgMGw1NS41IDk2QTY0IDY0IDAgMCAxIDk2IDcyLjZaIi8+PC9zdmc+',
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOng9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHZpZXdCb3g9IjAgMCA1MTUwMCA1MTUwMCI+PHJhZGlhbEdyYWRpZW50IGlkPSJiIiBjeD0iODcuNCUiIGN5PSItMTIuOSUiIHI9IjEyOCUiIGdyYWRpZW50VHJhbnNmb3JtPSJtYXRyaXgoLjggMCAwIDEgLjE4IC4xMykiPjxzdG9wIG9mZnNldD0iLjEzIiBzdG9wLWNvbG9yPSIjZmZiZDRmIi8+PHN0b3Agb2Zmc2V0PSIuMjgiIHN0b3AtY29sb3I9IiNmZjk4MGUiLz48c3RvcCBvZmZzZXQ9Ii40NyIgc3RvcC1jb2xvcj0iI2ZmMzc1MCIvPjxzdG9wIG9mZnNldD0iLjc4IiBzdG9wLWNvbG9yPSIjZWIwODc4Ii8+PHN0b3Agb2Zmc2V0PSIuODYiIHN0b3AtY29sb3I9IiNlNTAwODAiLz48L3JhZGlhbEdyYWRpZW50PjxyYWRpYWxHcmFkaWVudCBpZD0iZCIgY3g9IjQ5JSIgY3k9IjQwJSIgcj0iMTI4JSIgZ3JhZGllbnRUcmFuc2Zvcm09Im1hdHJpeCguODIgMCAwIDEgLjA5IDApIj48c3RvcCBvZmZzZXQ9Ii4zIiBzdG9wLWNvbG9yPSIjOTYwZTE4Ii8+PHN0b3Agb2Zmc2V0PSIuMzUiIHN0b3AtY29sb3I9IiNiMTE5MjciIHN0b3Atb3BhY2l0eT0iLjc0Ii8+PHN0b3Agb2Zmc2V0PSIuNDMiIHN0b3AtY29sb3I9IiNkYjI5M2QiIHN0b3Atb3BhY2l0eT0iLjM0Ii8+PHN0b3Agb2Zmc2V0PSIuNSIgc3RvcC1jb2xvcj0iI2Y1MzM0YiIgc3RvcC1vcGFjaXR5PSIuMSIvPjxzdG9wIG9mZnNldD0iLjUzIiBzdG9wLWNvbG9yPSIjZmYzNzUwIiBzdG9wLW9wYWNpdHk9IjAiLz48L3JhZGlhbEdyYWRpZW50PjxyYWRpYWxHcmFkaWVudCBpZD0iZSIgY3g9IjQ4JSIgY3k9Ii0xMiUiIHI9IjE0MCUiPjxzdG9wIG9mZnNldD0iLjEzIiBzdG9wLWNvbG9yPSIjZmZmNDRmIi8+PHN0b3Agb2Zmc2V0PSIuNTMiIHN0b3AtY29sb3I9IiNmZjk4MGUiLz48L3JhZGlhbEdyYWRpZW50PjxyYWRpYWxHcmFkaWVudCBpZD0iZiIgY3g9IjIyLjc2JSIgY3k9IjExMC4xMSUiIHI9IjEwMCUiPjxzdG9wIG9mZnNldD0iLjM1IiBzdG9wLWNvbG9yPSIjM2E4ZWU2Ii8+PHN0b3Agb2Zmc2V0PSIuNjciIHN0b3AtY29sb3I9IiM5MDU5ZmYiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNjMTM5ZTYiLz48L3JhZGlhbEdyYWRpZW50PjxyYWRpYWxHcmFkaWVudCBpZD0iaCIgY3g9IjUyJSIgY3k9IjMzJSIgcj0iNTklIiBncmFkaWVudFRyYW5zZm9ybT0ic2NhbGUoLjkgMSkiPjxzdG9wIG9mZnNldD0iLjIxIiBzdG9wLWNvbG9yPSIjOTA1OWZmIiBzdG9wLW9wYWNpdHk9IjAiLz48c3RvcCBvZmZzZXQ9Ii45NyIgc3RvcC1jb2xvcj0iIzZlMDA4YiIgc3RvcC1vcGFjaXR5PSIuNiIvPjwvcmFkaWFsR3JhZGllbnQ+PHJhZGlhbEdyYWRpZW50IGlkPSJpIiBjeD0iMjEwJSIgY3k9Ii0xMDAlIiByPSIyOTAlIj48c3RvcCBvZmZzZXQ9Ii4xIiBzdG9wLWNvbG9yPSIjZmZlMjI2Ii8+PHN0b3Agb2Zmc2V0PSIuNzkiIHN0b3AtY29sb3I9IiNmZjcxMzkiLz48L3JhZGlhbEdyYWRpZW50PjxyYWRpYWxHcmFkaWVudCBpZD0iaiIgY3g9Ijg0JSIgY3k9Ii00MSUiIHI9IjE4MCUiPjxzdG9wIG9mZnNldD0iLjExIiBzdG9wLWNvbG9yPSIjZmZmNDRmIi8+PHN0b3Agb2Zmc2V0PSIuNDYiIHN0b3AtY29sb3I9IiNmZjk4MGUiLz48c3RvcCBvZmZzZXQ9Ii43MiIgc3RvcC1jb2xvcj0iI2ZmMzY0NyIvPjxzdG9wIG9mZnNldD0iLjkiIHN0b3AtY29sb3I9IiNlMzE1ODciLz48L3JhZGlhbEdyYWRpZW50PjxyYWRpYWxHcmFkaWVudCBpZD0iayIgY3g9IjE2LjElIiBjeT0iLTE4LjYlIiByPSIzNDguOCUiIGdyYWRpZW50VHJhbnNmb3JtPSJtYXRyaXgoLjEwNDUzIC40Njc0MyAtLjk5NDUyIC4wNDkxMyAtLjA1IC0uMjYpIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNmZmY0NGYiLz48c3RvcCBvZmZzZXQ9Ii4zIiBzdG9wLWNvbG9yPSIjZmY5ODBlIi8+PHN0b3Agb2Zmc2V0PSIuNTciIHN0b3AtY29sb3I9IiNmZjM2NDciLz48c3RvcCBvZmZzZXQ9Ii43NCIgc3RvcC1jb2xvcj0iI2UzMTU4NyIvPjwvcmFkaWFsR3JhZGllbnQ+PHJhZGlhbEdyYWRpZW50IGlkPSJsIiBjeD0iMTguOSUiIGN5PSItNDIuNSUiIHI9IjIzOC40JSI+PHN0b3Agb2Zmc2V0PSIuMTQiIHN0b3AtY29sb3I9IiNmZmY0NGYiLz48c3RvcCBvZmZzZXQ9Ii40OCIgc3RvcC1jb2xvcj0iI2ZmOTgwZSIvPjxzdG9wIG9mZnNldD0iLjY2IiBzdG9wLWNvbG9yPSIjZmYzNjQ3Ii8+PHN0b3Agb2Zmc2V0PSIuOSIgc3RvcC1jb2xvcj0iI2UzMTU4NyIvPjwvcmFkaWFsR3JhZGllbnQ+PHJhZGlhbEdyYWRpZW50IGlkPSJtIiBjeD0iMTU5LjMlIiBjeT0iLTQ0LjcyJSIgcj0iMzEzLjElIj48c3RvcCBvZmZzZXQ9Ii4wOSIgc3RvcC1jb2xvcj0iI2ZmZjQ0ZiIvPjxzdG9wIG9mZnNldD0iLjYzIiBzdG9wLWNvbG9yPSIjZmY5ODBlIi8+PC9yYWRpYWxHcmFkaWVudD48bGluZWFyR3JhZGllbnQgaWQ9ImEiIHgxPSI4Ny4yNSUiIHgyPSI5LjQlIiB5MT0iMTUuNSUiIHkyPSI5My4xJSI+PHN0b3Agb2Zmc2V0PSIuMDUiIHN0b3AtY29sb3I9IiNmZmY0NGYiLz48c3RvcCBvZmZzZXQ9Ii4zNyIgc3RvcC1jb2xvcj0iI2ZmOTgwZSIvPjxzdG9wIG9mZnNldD0iLjUzIiBzdG9wLWNvbG9yPSIjZmYzNjQ3Ii8+PHN0b3Agb2Zmc2V0PSIuNyIgc3RvcC1jb2xvcj0iI2UzMTU4NyIvPjwvbGluZWFyR3JhZGllbnQ+PGxpbmVhckdyYWRpZW50IGlkPSJuIiB4MT0iODAlIiB4Mj0iMTglIiB5MT0iMTQlIiB5Mj0iODQlIj48c3RvcCBvZmZzZXQ9Ii4xNyIgc3RvcC1jb2xvcj0iI2ZmZjQ0ZiIgc3RvcC1vcGFjaXR5PSIuOCIvPjxzdG9wIG9mZnNldD0iLjYiIHN0b3AtY29sb3I9IiNmZmY0NGYiIHN0b3Atb3BhY2l0eT0iMCIvPjwvbGluZWFyR3JhZGllbnQ+PHBhdGggaWQ9ImMiIGQ9Ik00Nzg3MCAxNjczNWMtMTA0NC0yNTEyLTMxNjAtNTIyNC00ODIwLTYwODIgMTM1MiAyNjUwIDIxMzQgNTMxMCAyNDMzIDcyOTQgMC02IDIgNSA0IDIybDQgMjZjMjI2OCA2MTQ3IDEwMzIgMTIzOTgtNzQ4IDE2MjE4LTI3NTQgNTkxMC05NDIwIDExOTY3LTE5ODU3IDExNjcwLTExMjc2LTMxOC0yMTIxMC04NjgzLTIzMDY0LTE5NjQzLTMzOC0xNzI4IDAtMjYwNSAxNzAtNDAwOC0yMDcgMTA4MC0yODYgMTM5NC0zOTAgMzMxNWwtMiAxMjNjMCAxMzI3MCAxMDc2MCAyNDAzMCAyNDAzMiAyNDAzMCAxMTg4NyAwIDIxNzU2LTg2MzAgMjM2OTAtMTk5NjNsMTEwLTkyN2M0NzctNDEyMC01My04NDUzLTE1NjAtMTIwNzV6Ii8+PHBhdGggaWQ9ImciIGQ9Ik0yNTY3NyAyMTA1MGMtNDAgNTk4LTIxNTAgMjY2MC0yODkwIDI2NjAtNjgzNCAwLTc5NDMgNDEzMy03OTQzIDQxMzMgMzAzIDM0ODAgMjcyNiA2MzQ4IDU2NjAgNzg2NSAxMzQgNzAgMjcwIDEzMCA0MDUgMTkzYTEzMjc3IDEzMjc3IDAgMDA3MDYgMjg5IDEwNjc0IDEwNjc0IDAgMDAzMTI3IDYwM2MxMTk3OCA1NjIgMTQzMDAtMTQzMjAgNTY1NS0xODY0MCAyMjEzLTM4NSA0NTEwIDUwNSA1Nzk0IDE0MDctMjEwMC0zNjcyLTYwMjUtNjE1MC0xMDUzMC02MTUwLTI4NSAwLTU2NCAyNC04NDQgNDNhMTIwMjUgMTIwMjUgMCAwMC02NjE0IDI1NDljMzY2IDMxMCA3ODAgNzI0IDE2NTAgMTU4MyAxNjMwIDE2MDYgNTgxMyAzMjcwIDU4MjIgMzQ2NXoiLz48cGF0aCBmaWxsPSJ1cmwoI2EpIiBkPSJNNDc4NzAgMTY3MzVjLTEwNDQtMjUxMi0zMTYwLTUyMjQtNDgyMC02MDgyIDEzNTIgMjY1MCAyMTM0IDUzMTAgMjQzMyA3Mjk0bDUgNDBjLTI3MTgtNjc3My03MzI1LTk1MDUtMTEwODgtMTU0NTJsLTU2Ni05MjBhNzM3MiA3MzcyIDAgMDEtMjY1LTQ5NyA0MzcwIDQzNzAgMCAwMS0zNTktOTUwIDYzIDYzIDAgMDAtNTUtNjUgODIgODIgMCAwMC00NSAwbC0xMiA3LTE3IDEwIDEwLTE0Yy02MDM3IDM1MzYtODA4NSAxMDA3Ni04Mjc0IDEzMzUwYTEyMDI1IDEyMDI1IDAgMDAtNjYxNCAyNTQ4IDcxMzYgNzEzNiAwIDAwLTYyMi00NzAgMTExMzQgMTExMzQgMCAwMS02OC01ODczYy0yNDY4IDExMjQtNDM5MCAyOTAwLTU3ODUgNDQ3MGgtMTBjLTk1My0xMjA2LTg4Ni01MTg3LTgzMi02MDE4LTEwLTUyLTcxMCAzNjMtODAyIDQyNWExNzUwNyAxNzUwNyAwIDAwLTIzNDkgMjAxMiAyMTA0OCAyMTA0OCAwIDAwLTIyNDQgMjY5MmwtMSAzdi0zYTIwMjg0IDIwMjg0IDAgMDAtMzIyNSA3MjgwbC0zMiAxNjBhMzk3MDAgMzk3MDAgMCAwMC0yMzcgMTUwMGwtNSA1MmEyMjkwNyAyMjkwNyAwIDAwLTM5MCAzMzE2bC0xIDEyMGMwIDEzMjcwIDEwNzYwIDI0MDMwIDI0MDMyIDI0MDMwIDExODg3IDAgMjE3NTYtODYzMCAyMzY5MC0xOTk2M2wxMTAtOTI3YzQ3Ny00MTIwLTUzLTg0NTMtMTU2MC0xMjA3NXpNMjAxNzAgMzU1NDVjMTEzIDUzIDIyMCAxMTIgMzM0IDE2NGwxNiAxMGExMjYyMCAxMjYyMCAwIDAxLTM1MC0xNzR6bTU1MDYtMTQ0OTN6bTE5ODEzLTMwNjBsLTMtMjMgNCAyNnoiLz48dXNlIGZpbGw9InVybCgjYikiIHg6aHJlZj0iI2MiLz48dXNlIGZpbGw9InVybCgjZCkiIHg6aHJlZj0iI2MiLz48cGF0aCBmaWxsPSJ1cmwoI2UpIiBkPSJNMzYxOTIgMTk1NjBsMTUwIDExMGExMzA3MCAxMzA3MCAwIDAwLTIyMzEtMjkxMUMyNjY0MCA5MjkwIDMyMTUwIDU2MyAzMzA4MCAxMjBsMTAtMTNjLTYwMzcgMzUzNS04MDg1IDEwMDc2LTgyNzMgMTMzNDggMjgwLTIwIDU2MC00MyA4NDQtNDMgNDUwNSAwIDg0MzAgMjQ3NyAxMDUzMCA2MTUweiIvPjx1c2UgZmlsbD0idXJsKCNmKSIgeDpocmVmPSIjZyIvPjx1c2UgZmlsbD0idXJsKCNoKSIgeDpocmVmPSIjZyIvPjxwYXRoIGZpbGw9InVybCgjaSkiIGQ9Ik0xNzA4MyAxNTIwNGEyNDQwNCAyNDQwNCAwIDAxNDk4IDMzMCAxMTEzNCAxMTEzNCAwIDAxLTY3LTU4NzRjLTI0NzAgMTEyNS00MzkwIDI5MDAtNTc4NSA0NDcwIDExNS0zIDM2MDAtNjYgNTM1NCAxMDc0eiIvPjxwYXRoIGZpbGw9InVybCgjaikiIGQ9Ik0xODIyIDI2MjQwYzE4NTUgMTA5NjAgMTE3ODggMTkzMjUgMjMwNjMgMTk2NDQgMTA0MzcgMjk2IDE3MTA0LTU3NjIgMTk4NTgtMTE2NzAgMTc4MC0zODIwIDMwMTYtMTAwNzAgNzQ4LTE2MjE4di0ybC00LTI0Yy0yLTE3LTQtMjgtNC0yMmw1IDQwYzg1MyA1NTY2LTE5ODAgMTA5NTgtNjQwNSAxNDYwNGwtMTMgMzBjLTg2MjUgNzAyMy0xNjg3OCA0MjM3LTE4NTUwIDMwOTdhMTQ0MTAgMTQ0MTAgMCAwMS0zNTAtMTc0Yy01MDI4LTI0MDMtNzEwNS02OTg0LTY2NjAtMTA5MTMtNDI0NSAwLTU2OTMtMzU4MC01NjkzLTM1ODBzMzgxMi0yNzE4IDg4MzYtMzU1YzQ2NTMgMjE5MCA5MDIzIDM1NSA5MDIzIDM1NC0xMC0xOTUtNDE5Mi0xODYwLTU4MjItMzQ2NS04NzItODYwLTEyODUtMTI3Mi0xNjUyLTE1ODNhNzEzNiA3MTM2IDAgMDAtNjIyLTQ3MCAyODI5MyAyODI5MyAwIDAwLTQ5OC0zMzBjLTE3NTMtMTE0MC01MjQwLTEwNzYtNTM1NS0xMDczaC0xMGMtOTUzLTEyMDctODg2LTUxODgtODMyLTYwMjAtMTAtNTAtNzEwIDM2My04MDIgNDI2YTE3NTA3IDE3NTA3IDAgMDAtMjM0OSAyMDEyIDIxMDQ4IDIxMDQ4IDAgMDAtMjI0NCAyNjkybC0xIDN2LTNhMjAyODQgMjAyODQgMCAwMC0zMjI1IDcyODBjLTEwIDUyLTg2NSAzNzg0LTQ0NCA1NzIweiIvPjxwYXRoIGZpbGw9InVybCgjaykiIGQ9Ik0zNDExMCAxNjc2MGExMzA3MCAxMzA3MCAwIDAxMjIzMSAyOTEwbDM2MCAyOTZjNTQ1MCA1MDIwIDI1OTQgMTIxMjAgMjM4MCAxMjYyNiA0NDI2LTM2NDYgNzI1OC05MDM4IDY0MDUtMTQ2MDQtMjcxNi02Nzc0LTczMjMtOTUwNi0xMTA4Ni0xNTQ1M2wtNTY2LTkyMGE3MzcyIDczNzIgMCAwMS0yNjUtNDk3IDQzNzAgNDM3MCAwIDAxLTM1OS05NTAgNjMgNjMgMCAwMC01NS02NSA4MiA4MiAwIDAwLTQ1IDBsLTEyIDctMTcgMTBjLTkzMCA0NDMtNjQ0MCA5MTcwIDEwMzAgMTY2NDB6Ii8+PHBhdGggZmlsbD0idXJsKCNsKSIgZD0iTTM2NzAyIDE5OTY1YTQ3NDMgNDc0MyAwIDAwLTM2MC0yOTVsLTE1MC0xMTBjLTEyODMtOTAwLTM1ODAtMTc5Mi01Nzk0LTE0MDcgODY0NCA0MzIyIDYzMjMgMTkyMDMtNTY1NSAxODY0MGExMDY3NCAxMDY3NCAwIDAxLTMxMjctNjAzIDEzNDUxIDEzNDUxIDAgMDEtNzA2LTI4OSA5MDY0IDkwNjQgMCAwMS00MDUtMTkzbDE2IDEwYzE2NzAgMTE0MCA5OTI0IDM5MjUgMTg1NTAtMzA5N2wxMy0zMGMyMTMtNTA2IDMwNjgtNzYwNi0yMzgwLTEyNjI2eiIvPjxwYXRoIGZpbGw9InVybCgjbSkiIGQ9Ik0xNDg0NCAyNzg0NHMxMTEwLTQxMzMgNzk0My00MTMzYzc0MCAwIDI4NTAtMjA2MiAyODkwLTI2NjBzLTQzNzAgMTgzNi05MDIzLTM1NGMtNTAyNC0yMzYzLTg4MzYgMzU0LTg4MzYgMzU0czE0NDggMzU4MCA1NjkzIDM1ODBjLTQ0NSAzOTMwIDE2MzIgODUxMCA2NjYwIDEwOTEzIDExMyA1MyAyMTggMTEyIDMzNCAxNjQtMjkzNS0xNTE3LTUzNTgtNDM4NC01NjYwLTc4NjV6Ii8+PHBhdGggZmlsbD0idXJsKCNuKSIgZD0iTTQ3ODcwIDE2NzM1Yy0xMDQ0LTI1MTItMzE2MC01MjI0LTQ4MjAtNjA4MiAxMzUyIDI2NTAgMjEzNCA1MzEwIDI0MzMgNzI5NGw1IDQwYy0yNzE4LTY3NzMtNzMyNS05NTA1LTExMDg4LTE1NDUybC01NjYtOTIwYTczNzIgNzM3MiAwIDAxLTI2NS00OTcgNDM3MCA0MzcwIDAgMDEtMzU5LTk1MCA2MyA2MyAwIDAwLTU1LTY1IDgyIDgyIDAgMDAtNDUgMGwtMTIgNy0xNyAxMCAxMC0xNGMtNjAzNyAzNTM2LTgwODUgMTAwNzYtODI3NCAxMzM1MCAyODAtMjAgNTYwLTQzIDg0NS00MyA0NTA1IDAgODQzMCAyNDc3IDEwNTMwIDYxNDgtMTI4NC05MDAtMzU4MC0xNzkyLTU3OTUtMTQwNyA4NjQ0IDQzMjIgNjMyMyAxOTIwMy01NjU1IDE4NjQwYTEwNjc0IDEwNjc0IDAgMDEtMzEyNy02MDMgMTM0NTEgMTM0NTEgMCAwMS03MDYtMjg5IDkwNjQgOTA2NCAwIDAxLTQwNS0xOTNsMTcgMTBhMTQ0MTAgMTQ0MTAgMCAwMS0zNTAtMTc0YzExMiA1MyAyMTggMTEyIDMzMyAxNjQtMjkzNS0xNTE3LTUzNTgtNDM4NC01NjYwLTc4NjUgMCAwIDExMDgtNDEzMyA3OTQyLTQxMzMgNzQwIDAgMjg1MC0yMDYyIDI4OTAtMjY2MC0xMC0xOTUtNDE5MC0xODYwLTU4MjItMzQ2NS04NzAtODYwLTEyODUtMTI3Mi0xNjUwLTE1ODNhNzEzNiA3MTM2IDAgMDAtNjIzLTQ3MCAxMTEzNCAxMTEzNCAwIDAxLTY3LTU4NzNjLTI0NzAgMTEyNC00MzkwIDI5MDAtNTc4NSA0NDcwaC0xMGMtOTUzLTEyMDctODg2LTUxODctODMyLTYwMjAtMTAtNTAtNzEwIDM2My04MDIgNDI2YTE3NTA3IDE3NTA3IDAgMDAtMjM0OSAyMDEyIDIxMDQ4IDIxMDQ4IDAgMDAtMjI0MyAyNjkybC0xIDN2LTNhMjAyODQgMjAyODQgMCAwMC0zMjI1IDcyODBsLTMyIDE2MGEzOTc4NyAzOTc4NyAwIDAwLTI3NyAxNTE1Yy0yIDE4IDItMTcgMCAwYTI3OTU2IDI3OTU2IDAgMDAtMzU1IDMzNTNsLTMgMTIyYzAgMTMyNzAgMTA3NjAgMjQwMzAgMjQwMzIgMjQwMzAgMTE4ODcgMCAyMTc1Ni04NjMwIDIzNjkwLTE5OTYzbDExMC05MjdjNDc3LTQxMjAtNTMtODQ1My0xNTYwLTEyMDc1em0tMjM4NCAxMjM0bDQgMjZ2LTJsLTQtMjR6Ii8+PC9zdmc+',
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB2aWV3Qm94PSIxOTQuNSAxOTAuMSAxMzUuMSAxMzUuMSI+PHN0eWxlPi5ie2NvbG9yLWludGVycG9sYXRpb24tZmlsdGVyczpzcmdifS5je2Zsb29kLW9wYWNpdHk6LjMxfTwvc3R5bGU+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJhIiB4MT0iMTMyLjU1IiB4Mj0iMTM0LjM3IiB5MT0iMTExLjY3IiB5Mj0iLTEwNS4zIiB4bGluazpocmVmPSIjYiI+PHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjZDJkMmQyIi8+PHN0b3Agb2Zmc2V0PSIuNTMiIHN0b3AtY29sb3I9IiNmMmYyZjIiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNmZmYiLz48L2xpbmVhckdyYWRpZW50PjxsaW5lYXJHcmFkaWVudCBpZD0iYiIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiLz48bGluZWFyR3JhZGllbnQgaWQ9ImMiIHgxPSI2NS40NCIgeDI9IjY3LjQiIHkxPSIxMTUuNzIiIHkyPSIxNy4xNCIgeGxpbms6aHJlZj0iI2IiPjxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iIzAwNWFkNSIvPjxzdG9wIG9mZnNldD0iLjE2IiBzdG9wLWNvbG9yPSIjMDg3NWYwIi8+PHN0b3Agb2Zmc2V0PSIuMzEiIHN0b3AtY29sb3I9IiMyMThjZWUiLz48c3RvcCBvZmZzZXQ9Ii42MyIgc3RvcC1jb2xvcj0iIzI3YTVmMyIvPjxzdG9wIG9mZnNldD0iLjgxIiBzdG9wLWNvbG9yPSIjMjVhYWYyIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMjFhYWVmIi8+PC9saW5lYXJHcmFkaWVudD48bGluZWFyR3JhZGllbnQgaWQ9ImQiIHgxPSIxNTguNyIgeDI9IjE3Ni4yOCIgeTE9Ijk2LjcxIiB5Mj0iNzkuNTMiIHhsaW5rOmhyZWY9IiNiIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNjNzJlMjQiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNmZDNiMmYiLz48L2xpbmVhckdyYWRpZW50PjxmaWx0ZXIgaWQ9ImUiIGNsYXNzPSJiIj48ZmVGbG9vZCBmbG9vZC1vcGFjaXR5PSIuMjgiLz48ZmVDb21wb3NpdGUgaW4yPSJTb3VyY2VHcmFwaGljIiBvcGVyYXRvcj0iaW4iLz48ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSIzIi8+PGZlT2Zmc2V0IGR4PSIuMyIgZHk9IjIuOCIvPjxmZUNvbXBvc2l0ZSBpbj0iU291cmNlR3JhcGhpYyIvPjwvZmlsdGVyPjxmaWx0ZXIgaWQ9ImYiIGNsYXNzPSJiIj48ZmVGbG9vZCBjbGFzcz0iYyIvPjxmZUNvbXBvc2l0ZSBjbGFzcz0iYyIgaW4yPSJTb3VyY2VHcmFwaGljIiBvcGVyYXRvcj0ib3V0Ii8+PGZlR2F1c3NpYW5CbHVyIGZsb29kLW9wYWNpdHk9Ii4zIiBzdGREZXZpYXRpb249Ii43Ii8+PGZlT2Zmc2V0IGR5PSIxLjgiLz48ZmVDb21wb3NpdGUgaW4yPSJTb3VyY2VHcmFwaGljIiBvcGVyYXRvcj0iYXRvcCIvPjwvZmlsdGVyPjxmaWx0ZXIgaWQ9ImciIGNsYXNzPSJiIj48ZmVGbG9vZCBmbG9vZC1vcGFjaXR5PSIuNjEiLz48ZmVDb21wb3NpdGUgaW4yPSJTb3VyY2VHcmFwaGljIiBvcGVyYXRvcj0iaW4iLz48ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSIuNSIvPjxmZU9mZnNldCBkeD0iLjgiIGR5PSIuOCIvPjxmZUNvbXBvc2l0ZSBpbj0iU291cmNlR3JhcGhpYyIgcmVzdWx0PSJBIi8+PGZlQ29sb3JNYXRyaXggdmFsdWVzPSIwIDAgMCAtMSAwIDAgMCAwIC0xIDAgMCAwIDAgLTEgMCAwIDAgMCAxIDAiLz48ZmVGbG9vZCBmbG9vZC1vcGFjaXR5PSIuNCIvPjxmZUNvbXBvc2l0ZSBpbjI9IkEiIG9wZXJhdG9yPSJpbiIvPjxmZUdhdXNzaWFuQmx1ciBzdGREZXZpYXRpb249IjMuOCIvPjxmZU9mZnNldCBkeD0iMi4zIiBkeT0iMy4zIi8+PGZlQ29tcG9zaXRlIGluPSJBIi8+PC9maWx0ZXI+PGZpbHRlciBpZD0iaCIgd2lkdGg9IjExMCUiIGhlaWdodD0iMTEwJSIgeD0iLTElIiB5PSItMSUiPjxmZUdhdXNzaWFuQmx1ciBpbj0iU291cmNlQWxwaGEiIHN0ZERldmlhdGlvbj0iLjQiLz48ZmVPZmZzZXQgZHg9Ii4xIiBkeT0iLjIiLz48ZmVDb21wb25lbnRUcmFuc2ZlciByZXN1bHQ9IkEiPjxmZUZ1bmNBIHR5cGU9ImxpbmVhciIvPjwvZmVDb21wb25lbnRUcmFuc2Zlcj48ZmVGbG9vZCBmbG9vZC1jb2xvcj0icmdiYSgwLDAsMCwwLjUpIi8+PGZlQ29tcG9zaXRlIGluMj0iQSIgb3BlcmF0b3I9ImluIi8+PGZlTWVyZ2U+PGZlTWVyZ2VOb2RlLz48ZmVNZXJnZU5vZGUgaW49IlNvdXJjZUdyYXBoaWMiLz48L2ZlTWVyZ2U+PC9maWx0ZXI+PHJhZGlhbEdyYWRpZW50IGlkPSJpIiBjeD0iLTY5Ljg4IiBjeT0iNjkuMjkiIHI9IjU0LjAxIiBncmFkaWVudFRyYW5zZm9ybT0ibWF0cml4KC45MDIzIC0uMDEyNDkgLjAzNzcgMi43MjM0IC05LjQ0IC0xMjAuMjkpIiB4bGluazpocmVmPSIjYiI+PHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjMjRhNWYzIiBzdG9wLW9wYWNpdHk9Ii4wMSIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzFlOGNlYiIgc3RvcC1vcGFjaXR5PSIuOTgiLz48L3JhZGlhbEdyYWRpZW50PjxyYWRpYWxHcmFkaWVudCBpZD0iaiIgY3g9IjEwOS4zNSIgY3k9IjEzLjc2IiByPSI5My4wOCIgZ3JhZGllbnRUcmFuc2Zvcm09Im1hdHJpeCgtLjAxODIyIDEuMDkyMiAtMS4wNDIgLS4wMTc2NSAxMzYuOTUgLTExNS4zMykiIHhsaW5rOmhyZWY9IiNiIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3Atb3BhY2l0eT0iMCIvPjxzdG9wIG9mZnNldD0iLjk2IiBzdG9wLWNvbG9yPSIjNTQ4OGQ2IiBzdG9wLW9wYWNpdHk9IjAiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiM1ZDk2ZWIiLz48L3JhZGlhbEdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iMjIwIiBoZWlnaHQ9IjIyMCIgeD0iMjIiIHk9Ii0xMDYuNTMiIGZpbGw9InVybCgjYSkiIGZpbHRlcj0idXJsKCNlKSIgcnk9IjQ5IiB0cmFuc2Zvcm09Im1hdHJpeCguNTY5MzggMCAwIC41NjkyMSAxODYuODYgMjU1Ljc1KSIvPjxnIGZpbHRlcj0idXJsKCNmKSIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMTk0LjIgMTkwLjA3KSI+PGVsbGlwc2UgY3g9IjY3Ljc3IiBjeT0iNjcuNzMiIGZpbGw9InVybCgjYykiIHBhaW50LW9yZGVyPSJzdHJva2UgZmlsbCBtYXJrZXJzIiByeD0iNTQuMDEiIHJ5PSI1My45OCIvPjxlbGxpcHNlIGN4PSItNjkuODgiIGN5PSI2OS4yOSIgZmlsbD0idXJsKCNpKSIgcng9IjU0LjAxIiByeT0iNTMuOTgiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDEzNy42NSAtMS41NSkiLz48L2c+PGVsbGlwc2UgY3g9IjEyMCIgY3k9IjE0LjE1IiBmaWxsPSJ1cmwoI2opIiByeD0iOTMuMDgiIHJ5PSI5My42NyIgdHJhbnNmb3JtPSJtYXRyaXgoLjU4MDgyIDAgMCAuNTc2MzYgMTkyLjMgMjQ5LjYzKSIvPjxnIGZpbHRlcj0idXJsKCNnKSIgdHJhbnNmb3JtPSJtYXRyaXgoLjU4Mjg5IDAgMCAuNTY1MDggMTk2LjggMTgxLjYzKSI+PHBhdGggZmlsbD0iI2NhYzdjOCIgZD0ibTQ2IDE5MS42Ni43My4zNSA3Mi4xOC00OC4yLTcuMzQtOC45NUw0NiAxOTEuNjZaIi8+PHBhdGggZmlsbD0iI2ZiZmZmYyIgZD0ibTQ1LjggMTkwLjg3LjIuOCA2NS41Ny01Ni44LTYuOTUtOC45Mi01OC44MyA2NC45MloiLz48cGF0aCBmaWxsPSJ1cmwoI2QpIiBkPSJtMTE4LjkxIDE0My44MS03LjM1LTguOTUgNjYuMDgtNTcuMi4yNy43My01OSA2NS40MloiLz48cGF0aCBmaWxsPSIjZmI2NDVjIiBkPSJtMTA0LjYyIDEyNS45NSA2Ljk0IDguOTIgNjYuMDgtNTcuMi0uNjUtLjM1LTcyLjM3IDQ4LjYzWiIvPjwvZz48cGF0aCBzdHJva2U9IiNmZmYiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLW1pdGVybGltaXQ9IjEiIHN0cm9rZS13aWR0aD0iMS4zMyIgZD0ibTI4Ni41OSAyNzguNDQgMy4xNC0yLjE0bS0xMS4yMy0xNy44IDcuOC0xLjM3bS04LjMyLTIuOSAzLjc4LS4zbS0zLjMtMTIuNDcgNy44IDEuMzhtLTguMiAzLjAzIDMuNzYuMzhtLTEuMi0xMy4wNSA3LjQ3IDIuNzNtLTMuNzctMTAuNSA2Ljg2IDMuOTZtLTEuODctMTAuOTYgNi4wNyA1LjA5bS4wNS0xMS4wNyA1LjA5IDYuMDdtMS45Ny0xMC45OSAzLjk3IDYuODZtMy43LTEwLjUzIDIuNzEgNy40M201LjYyLTkuNjIgMS4zNyA3LjhtMTUuNjItNy44OS0xLjM4IDcuOG05LjgyLTUuNi0yLjcyIDcuNDJtMTAuNS0zLjc1LTMuOTYgNi44Nm0xMC45OC0xLjg5LTUuMTIgNi4wN20xNi4xOCA2Ljk2LTYuODcgMy45Nm0xMC40NSAzLjg4LTcuNDUgMi43bTkuNjQgNS42LTcuODIgMS4zOG03LjgxIDE1Ljc5LTcuODItMS4zOW01LjYgOS43LTcuNDQtMi43MW0zLjggMTAuNDctNi44Ny0zLjk1bTEuOTEgMTAuOTgtNi4wNy01LjA3bS0uMDUgMTEuMi01LjEtNi4wOG0tMS45NSAxMC45OS00LTYuODhtLTMuODcgMTAuNS0yLjctNy40M20tNS42MSA5LjYxLTEuMzctNy43OG0tMTUuNzggNy43NSAxLjQtNy44Nm0tOS43IDUuNTggMi43Mi03LjQ3bS0xMC41IDMuNzMgMy45Ny02Ljg3bS0xMC45NiAxLjkgNS4wOC02LjAzbS04LjI2IDMuMTMgMi43NS0yLjY4bTMuODQgOC4yMyAyLjItMy4xbTUuMiA3LjQ0IDEuNjYtMy40NW02LjQzIDYuNDcgMS4wMi0zLjdtNy41MiA1LjMyLjQzLTMuODJtOC4wOCAzLjgtLjMxLTMuODRtOC44MSAyLjMzLS45Ny0zLjY5bTkuMDYuNzUtMS41OC0zLjQ4bTkuMDUtLjc2LTIuMTYtMy4xOG04Ljc4LTIuMzgtMi42OC0yLjczbTguMjQtMy44NS0zLjExLTIuMm03LjQyLTUuMi0zLjQ3LTEuNjdtNi40Mi02LjQxLTMuNy0xLjAzbTUuMTctNy40Ni0zLjc4LS4zN20zLjgtOC4yNC0zLjgxLjNtMi4zNS04LjgtMy43Ljk3bS44LTkuMDYtMy40OSAxLjYxbS0xLjAzLTkuMTItMy4yIDIuMm0tMi4xMi04LjYyLTIuNzIgMi43bS0zLjg0LTguMjgtMi4yMyAzLjEybS01LjIxLTcuNDUtMS42NiAzLjQ0bS02LjU1LTYuMzItMS4wMiAzLjYzbS03LjQyLTUuMi0uMzggMy44MW0tOC4wOS0zLjY2LjI4IDMuOG0tOC43OS0yLjM0Ljk1IDMuNjhtLTguOS0uNzIgMS42MSAzLjQ2bS05LjA2LjgyIDIuMTggMy4xNm0tOC44MiAyLjI3IDIuNjggMi43bS04LjI1IDMuODUgMy4xIDIuMjNtLTcuNDQgNS4xNyAzLjQyIDEuNjZtLTYuMyA2LjM2IDMuNyAxLjA1bS0zLjcxIDI0LjM5IDMuNy0uOTFtLTIuNDQgNS4wMyA3LjQ4LTIuNzJtLTUuODYgNi43MyAzLjUtMS42MW0tMS41MyA1LjQzIDYuODctMy45NW0tMTMuMzMtMjAuNTIgNy45Ni4wMW00MS4xNi00MS40NHYtNy45Nm0uMDIgOTguNzQuMDEtNy45NG00OS4zMy00MS40LTcuOTUtLjAxIiBmaWx0ZXI9InVybCgjaCkiIHRyYW5zZm9ybT0idHJhbnNsYXRlKC02NSA3LjczKSIvPjwvc3ZnPg==',
];
// Each engine's page: [kind, x0, y0, x1, y1, parent, lift], parents before children, far before near.
// lift is how far the element comes off its parent when the page comes apart, in units of the slider's gap.
const PAGES = [
  [
    ['body', 6, 34, 164, 142, -1, 0.6],
    ['nav', 12, 40, 158, 52, 0, 1],
    ['img', 12, 58, 92, 136, 0, 1.6],
    ['copy', 98, 58, 158, 82, 0, 0.8],
    ['button', 98, 92, 136, 104, 0, 1.2],
  ],
  [
    ['body', 6, 34, 164, 142, -1, 0.6],
    ['nav', 12, 40, 158, 52, 0, 0.9],
    ['link', 120, 43, 154, 49, 1, 0.7],
    ['video', 12, 58, 108, 116, 0, 1.5],
    ['copy', 12, 122, 108, 136, 0, 0.8],
    ['card', 114, 58, 158, 136, 0, 1.1],
    ['img', 118, 62, 154, 88, 5, 0.8],
    ['copy', 118, 94, 154, 132, 5, 0.6],
  ],
  [
    ['body', 6, 34, 164, 142, -1, 0.6],
    ['nav', 12, 40, 158, 52, 0, 0.9],
    ['link', 16, 43, 42, 49, 1, 0.7],
    ['card', 40, 58, 130, 138, 0, 1.1],
    ['copy', 48, 62, 122, 70, 3, 0.6],
    ['input', 48, 76, 122, 88, 3, 0.8],
    ['input', 48, 94, 122, 106, 3, 1.2],
    ['button', 48, 114, 122, 128, 3, 1.6],
  ],
];
const NAMES = ['chromium', 'firefox', 'webkit'],
  REST_TOP = 0,
  LIFTED = 0.6;

/** The marks an element would really have on its top: lines of text, a mountain and a sun, a play triangle, a caret, a label. */
function detail(e, w) {
  const { x0, y0, x1, y1 } = e,
    cx = (x0 + x1) / 2,
    cy = (y0 + y1) / 2,
    wd = x1 - x0,
    ht = y1 - y0;
  if (e.name === 'copy') {
    const n = Math.max(1, Math.floor((ht - 3) / 5));
    return Array.from({ length: n }, (_, k) =>
      seg(
        w(x0 + 3, y0 + 4 + k * 5),
        w(x1 - 3 - (k % 3 === 2 ? wd * 0.35 : 0), y0 + 4 + k * 5),
      ),
    ).join('');
  }
  if (e.name === 'img') {
    const sun = Array.from({ length: 12 }, (_, k) =>
      w(
        x1 - wd * 0.22 + 3.5 * Math.cos((k * Math.PI) / 6),
        y0 + ht * 0.3 + 3.5 * Math.sin((k * Math.PI) / 6),
      ),
    );
    return (
      open([
        w(x0 + 3, y1 - 3),
        w(x0 + wd * 0.35, y0 + ht * 0.4),
        w(x0 + wd * 0.55, y1 - ht * 0.35),
        w(x0 + wd * 0.7, y1 - ht * 0.5),
        w(x1 - 3, y1 - 3),
      ]) + poly(sun)
    );
  }
  if (e.name === 'video')
    return poly([w(cx + 9, cy), w(cx - 6, cy - 9), w(cx - 6, cy + 9)]);
  if (e.name === 'button' || e.name === 'link')
    return seg(w(x0 + 5, cy), w(x1 - 5, cy));
  if (e.name === 'input') return seg(w(x0 + 5, y0 + 3), w(x0 + 5, y1 - 3));
  return '';
}

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let D = value;
  const C = Cam(45, 0.5, 1.3);
  // slot s (0 the bottom, 2 the top) sits straight up at height s × GAP
  const at = (s) => s * GAP,
    TOPZ = at(2);
  fit(
    C,
    [
      [0, 0, 0],
      [WX, WY, 0],
      [WX, 0, 0],
      [0, WY, 0],
      [0, 0, TOPZ + TK + 3 * 24],
      [WX, WY, TOPZ + TK + 3 * 24],
    ],
    200,
    166,
  );
  const P = proj(C),
    front = facing(C);
  const [pr, pi] = rings(0, 0, WX, WY, 6, 1.6);

  const g = mk('g', {}, svg);
  // a near-flat fade reads as one even shade over the whole stage; shades[i] lets i / SHADES of a window through
  const shades = Array.from({ length: SHADES }, (_, i) =>
    fade(svg, 0, 1e5, i / SHADES),
  );
  // engine k starts in slot 2 - k: Chrome on top, Safari at the bottom
  const layers = NAMES.map((name, k) => {
    const grp = mk('g', {}, g),
      plate = solid(grp);
    const bar = mk('path', { class: 'nf lo' }, grp),
      mark = mk('image', { href: LOGOS[k], width: 24, height: 24 }, grp);
    const dots = [0, 1, 2].map(() =>
      mk('circle', { r: 1.3, class: 'dot m' }, grp),
    );
    const els = PAGES[k].map(([en, x0, y0, x1, y1, parent, lift]) => {
      const [ring, inner] = rings(x0, y0, x1, y1, 2.5, 1);
      // the dashed drops go first, so the plate they hold up covers them
      const drop = mk('path', { class: 'dash' }, grp),
        el = solid(grp);
      return {
        name: en,
        x0,
        y0,
        x1,
        y1,
        parent,
        lift,
        ring,
        inner,
        drop,
        el,
        extra: mk('path', { class: 'nf' }, el.g),
      };
    });
    return {
      name,
      k,
      grp,
      plate,
      bar,
      mark,
      dots,
      els,
      ex: spring(0, { eps: 0.002 }),
      slot: 2 - k,
      z: tween(at(2 - k), SHIFT),
      a: tween(1, SINK),
      phase: '',
      drawn: '',
    };
  });

  function draw(L, now) {
    const z = tval(L.z, now);
    // a window fades out where it lies; coming back it is solid, so nothing under it ever shows through
    const shade = Math.round(
      SHADES * (L.phase === 'sink' ? tval(L.a, now) : 1),
    );
    const key = [z, shade, L.ex.x, D].join();
    if (key === L.drawn) return;
    L.drawn = key;
    if (shade < SHADES) L.grp.setAttribute('mask', shades[shade]);
    else L.grp.removeAttribute('mask');
    const Q = P,
      on = (zz) => (x, y) => Q(x, y, zz),
      top = z + TK,
      w = on(top);
    put(L.plate, prism(Q, front, pr, pi, z, top));
    L.bar.setAttribute(
      'd',
      seg(w(3, BAR), w(WX - 3, BAR)) +
        poly(rrect(52, 9, WX - 10, BAR - 9, 3, 4).map((q) => w(q.u, q.v))),
    );
    L.dots.forEach((el, j) => place(el, w(8 + j * 5, BAR / 2)));
    // the logo lies flat on the bar like a tab's icon, square to the window's edges; a projection is affine, so one matrix places it
    const h = 11,
      mx = 36,
      my = BAR / 2;
    const o = w(mx - h, my - h),
      r = w(mx + h, my - h),
      d = w(mx - h, my + h);
    L.mark.setAttribute(
      'transform',
      `matrix(${(r[0] - o[0]) / 24} ${(r[1] - o[1]) / 24} ${(d[0] - o[0]) / 24} ${(d[1] - o[1]) / 24} ${o[0]} ${o[1]})`,
    );
    const tops = [];
    L.els.forEach((e, i) => {
      // an element lifted by its gap is a thin plate over its parent, with dashed drops down to it; with no gap it is one outline on the page
      const gap = D * e.lift * L.ex.x,
        base = e.parent < 0 ? top : tops[e.parent],
        up = gap > 1,
        z0 = base + gap,
        z1 = up ? z0 + PT : base;
      tops[i] = z1;
      put(
        e.el,
        up
          ? prism(Q, front, e.ring, e.inner, z0, z1)
          : { sil: poly(ringAt(Q, e.ring, z1)), crease: '' },
      );
      e.drop.setAttribute(
        'd',
        up
          ? extremes(Q, e.ring)
              .map((q) => seg(Q(q.u, q.v, base), Q(q.u, q.v, z0)))
              .join('')
          : '',
      );
      e.extra.setAttribute('d', detail(e, on(z1)));
    });
  }

  let pick = -1;
  const topLayer = () => layers.find((L) => L.slot === 2);
  /** One turn: the bottom window fades out of sight, and once it is gone it comes down from above onto the top; the others step down a slot. */
  function turn(now) {
    const B = layers.find((L) => L.slot === 0);
    for (const L of layers) {
      if (L === B) continue;
      L.slot -= 1;
      tset(L.z, at(L.slot), now, LAG + L.slot * STAG);
    }
    Object.assign(B, { slot: 2, phase: 'sink', a: tween(1, SINK) });
    tset(B.a, 0, now, 0);
  }
  /** Moves a turning window on to its next phase once the current one has landed. */
  function advance(L, now) {
    if (!L.phase || !tdone(L.phase === 'sink' ? L.a : L.z, now)) return;
    L.phase = L.phase === 'sink' ? 'settle' : '';
    if (L.phase) tset((L.z = tween(TOPZ + RISE, SETTLE)), TOPZ, now, 0);
  }
  /** The page on top comes apart as one, on one spring; each element to its own height. */
  const lift = (L, up) => {
    L.ex.t = up ? 1 : 0;
  };
  /**
   * One step at a time: the page on top folds flat before the stack turns, the stack turns until the wanted window is on
   * top (twice for the middle one), and the new top's page comes apart only once every window has landed. At rest every
   * page is flat.
   */
  function sequence(now) {
    const want = pick < 0 ? REST_TOP : pick,
      T = topLayer();
    const flat = T.ex.t === 0 && T.ex.x * D < LIFTED;
    const landed = layers.every((L) => !L.phase && tdone(L.z, now));
    if (T.k !== want) {
      lift(T, false);
      if (flat && landed) turn(now);
      return true;
    }
    lift(T, landed && pick >= 0);
    return !landed;
  }

  const B = register(stage, (dt, now) => {
    layers.forEach((L) => advance(L, now));
    let moving = sequence(now);
    for (const L of layers) {
      if (stepS(L.ex, dt)) moving = true;
      draw(L, now);
    }
    // the bright edge is the window settled on top; a turning window is not lit
    for (const L of layers)
      L.plate.sil.classList.toggle('hi', L === topLayer() && !L.phase);
    // back to front by height: a fading window is under all, a window coming down from above is over all
    layers
      .slice()
      .sort((a, b) => tval(a.z, now) - tval(b.z, now))
      .forEach((L) => g.appendChild(L.grp));
    return moving;
  });
  bag.add(B.unregister);
  read.textContent = 'rest';

  // the windows touch, so the pointer's height picks an engine from three equal bands across the stack's height at rest:
  // the far third Chrome, the middle Firefox, the near third Safari. The bands never move, so a window moving cannot change the pick.
  const yTop = P(0, 0, TOPZ + TK)[1],
    yBot = P(WX, WY, 0)[1];
  function move(p) {
    pick = clamp(Math.floor(((p[1] - yTop) / (yBot - yTop)) * 3), 0, 2);
    read.textContent = NAMES[pick];
    B.wake();
  }
  bag.add(
    pointer(stage, {
      move,
      leave: () => {
        pick = -1;
        read.textContent = 'rest';
        B.wake();
      },
    }),
  );
  bag.add(() => svg.replaceChildren());
  return {
    set: (v) => {
      D = v;
      B.wake();
    },
    destroy: bag.dispose,
  };
}

const MEANS =
  'Three real browsers in a stack: the one picked comes to the top, then its page comes apart by DOM depth.';

/** Mounts the figure in `host` the way the package does, with a fixed gap, and plays its tour when asked. Returns the tear-down. */
export function mountBrowsers(host, { gap = 14, play = true } = {}) {
  HL.inject(host.ownerDocument);
  host.setAttribute('data-hairline', 'browsers');
  host.setAttribute('role', 'img');
  host.setAttribute('aria-label', MEANS);
  const svg = HL.mk(
    'svg',
    { viewBox: '0 0 400 320', 'aria-hidden': 'true' },
    host,
  );
  const figure = mount({ stage: host, svg, read: { textContent: '' } }, gap);
  // each engine gets two stops in its own band, so it holds the top for two dwells: Safari, Firefox, then Chrome
  const lap = play
    ? HL.tour(host, [
        [200, 242],
        [205, 238],
        [195, 190],
        [200, 186],
        [190, 139],
        [195, 143],
      ])
    : null;
  return () => {
    lap?.stop();
    figure.destroy();
    svg.remove();
    for (const name of ['data-hairline', 'role', 'aria-label'])
      host.removeAttribute(name);
  };
}
