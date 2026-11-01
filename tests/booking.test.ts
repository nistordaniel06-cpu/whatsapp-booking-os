import {describe,it,expect} from "vitest";import {isFree} from "../src/lib/booking";
describe("booking overlap",()=>{it("rejects overlap",()=>expect(isFree({start:10,end:40},[{start:30,end:60}])).toBe(false));it("allows adjacent slots",()=>expect(isFree({start:0,end:30},[{start:30,end:60}])).toBe(true))});
