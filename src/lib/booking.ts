export type Interval={start:number;end:number};
export function overlaps(a:Interval,b:Interval){if(a.end<=a.start||b.end<=b.start)throw new Error("Invalid interval");return a.start<b.end&&b.start<a.end}
export function isFree(candidate:Interval,occupied:Interval[]){return occupied.every(item=>!overlaps(candidate,item))}
