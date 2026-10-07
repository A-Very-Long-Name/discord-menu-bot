export const SCHOOLS = {
 wra:{name:'Western Reserve Academy',provider:'slides',hall:'Western Reserve Dining',url:'https://docs.google.com/presentation/d/1xHWF4RymuEc51msed9bs7XyhH-6N4OHg4dAH8cOofuA/edit',brunchDays:['Sat','Sun']},
 sps:{name:"St. Paul's School",host:'sps',slug:'st-pauls-school',hall:'Coit Dining Hall'},
 loomis:{brunchDays:['Sat','Sun'],name:'The Loomis Chaffee School',host:'loomischaffee',slug:'loomis-dining-hall',hall:'Loomis Dining Hall'},
 andover:{name:'Phillips Academy Andover',provider:'elevate',store:'ch_phillipsacademy_en',slug:'paresky-dining',station:230457,periods:{lunch:25,dinner:16},hall:'Paresky Dining',url:'https://phillipsacademy.mydininghub.com/en/location/paresky-dining'},
 groton:{name:'Groton School',host:'grotonschool',slug:'groton-school',hall:'Groton Dining Hall'},
 lawrenceville:{name:'The Lawrenceville School',provider:'html',hall:'Lawrenceville Dining',url:'https://sites.google.com/lawrenceville.org/dining-menu/home'},
 deerfield:{name:'Deerfield Academy',provider:'html',hall:'Deerfield Dining Hall',url:'https://deerfield.edu/students/dining-hall-and-stores/menu'},
 cate:{name:'Cate School',host:'cate',slug:'cate-school-high-school',hall:'Cate Dining Hall',zone:'America/Los_Angeles'},
 taft:{name:'The Taft School',provider:'elevate',store:'ch_taft_en',slug:'horace-dutton-taft',station:226174,periods:{lunch:25,dinner:16},hall:'Horace Dutton Taft',url:'https://taft.mydininghub.com/en/location/horace-dutton-taft'},
 peddie:{name:'Peddie School',provider:'events',hall:'Peddie Dining',url:'https://peddie.org/events/category/pfs-menus/list'}
};
export function school(id='sps'){if(!SCHOOLS[id])throw new Error('Unknown school');return {zone:'America/New_York',...SCHOOLS[id]};}

export function lunchReminderAllowed(id,weekday){return !(school(id).brunchDays||['Sun']).includes(weekday);}
