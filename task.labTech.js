// This task will react on labTech flags (invade/rob or red/yellow), sending 2 creeps to rob that room
let mod = {};
module.exports = mod;
// hook into events
mod.register = () => {
    // when a new flag has been found (occurs every tick, for each flag)
    Flag.found.on( flag => Task.labTech.handleFlagFound(flag) );
    // a creep starts spawning
    Creep.spawningStarted.on( params => Task.labTech.handleSpawningStarted(params) );
    // a creep completed spawning
    Creep.spawningCompleted.on( creep => Task.labTech.handleSpawningCompleted(creep) );
    // a creep will die soon
    Creep.predictedRenewal.on( creep => Task.labTech.handleCreepDied(creep.name) );
    // a creep died
    Creep.died.on( name => Task.labTech.handleCreepDied(name) );
};
// for each flag
mod.handleFlagFound = flag => {
    // if it is a labTech flag
    if( flag.color == FLAG_COLOR.labs.labTech.color && flag.secondaryColor == FLAG_COLOR.labs.labTech.secondaryColor){
        // check if a new creep has to be spawned
        Task.labTech.checkForRequiredCreeps(flag);
    }
};
// check if a new creep has to be spawned
mod.checkForRequiredCreeps = (flag) => {
    // get task memory
    let memory = Task.labTech.memory(flag);
    // count creeps assigned to task

    let count = memory.queued.length + memory.spawning.length + memory.running.length;
    
    // if creep count below requirement spawn a new creep creep 
    if( count < 1 ) {
        Task.spawn(
            Task.labTech.creep.labTech, // creepDefinition
            { // destiny
                task: 'labTech', // taskName
                targetName: flag.name, // targetName
            }, 
            { // spawn room selection params
                targetRoom: flag.pos.roomName, 
                minEnergyCapacity: 1000,
                rangeRclRatio: 6,
                maxRange: 1,
                explicit: true,
                allowTargetRoom: true
            },
            creepSetup => { // callback onQueued
                let memory = Task.labTech.memory(Game.flags[creepSetup.destiny.targetName]);
                memory.queued.push({
                    room: creepSetup.queueRoom,
                    name: creepSetup.name
            });
        });
    }
};
// when a creep starts spawning
mod.handleSpawningStarted = params => { // params: {spawn: spawn.name, name: creep.name, destiny: creep.destiny}
    // ensure it is a creep which has been queued by this task (else return)
    if ( !params.destiny || !params.destiny.task || params.destiny.task != 'labTech' )
        return;
    // get flag which caused queueing of that creep
    // TODO: remove  || creep.data.destiny.flagName (temporary backward compatibility)
    let flag = Game.flags[params.destiny.targetName || params.destiny.flagName];
    if (flag) {
        // get task memory
        let memory = Task.labTech.memory(flag);
        // save spawning creep to task memory
        memory.spawning.push(params);
        // clean/validate task memory queued creeps
        let queued = [];
        let validateQueued = o => {
            let room = Game.rooms[o.room];
            if( (room.spawnQueueMedium.some( c => c.name == o.name)) || (room.spawnQueueLow.some( c => c.name == o.name)) ){
                queued.push(o);
            }
        };
        memory.queued.forEach(validateQueued);
        memory.queued = queued;
    }
};
// when a creep completed spawning
mod.handleSpawningCompleted = creep => {
    // ensure it is a creep which has been requested by this task (else return)
    if (!creep.data || !creep.data.destiny || !creep.data.destiny.task || creep.data.destiny.task != 'labTech')
        return;
    // get flag which caused request of that creep
    // TODO: remove  || creep.data.destiny.flagName (temporary backward compatibility)
    let flag = Game.flags[creep.data.destiny.targetName || creep.data.destiny.flagName];
    if (flag) {
        // calculate & set time required to spawn and send next substitute creep
        // TODO: implement better distance calculation
        creep.data.predictedRenewal = creep.data.spawningTime + (routeRange(creep.data.homeRoom, flag.pos.roomName)*50);

        // get task memory
        let memory = Task.labTech.memory(flag);
        // save running creep to task memory
        memory.running.push(creep.name);
        // clean/validate task memory spawning creeps
        let spawning = [];
        let validateSpawning = o => {
            let spawn = Game.spawns[o.spawn];
            if( spawn && ((spawn.spawning && spawn.spawning.name == o.name) || (spawn.newSpawn && spawn.newSpawn.name == o.name))) {
                spawning.push(o);
            }
        };
        memory.spawning.forEach(validateSpawning);
        memory.spawning = spawning;
    }
};
// when a creep died (or will die soon)
mod.handleCreepDied = name => {
    // get creep memory
    let mem = Memory.population[name];
    // ensure it is a creep which has been requested by this task (else return)
    if (!mem || !mem.destiny || !mem.destiny.task || mem.destiny.task != 'labTech')
        return;
    // get flag which caused request of that creep
    // TODO: remove  || creep.data.destiny.flagName (temporary backward compatibility)
    let flag = Game.flags[mem.destiny.targetName || mem.destiny.flagName];
    if (flag) {
        // get task memory
        let memory = Task.labTech.memory(flag);
        // clean/validate task memory running creeps
        let running = [];
        let validateRunning = o => {
            let creep = Game.creeps[o];
            // invalidate old creeps for predicted spawning
            // TODO: better distance calculation
            if( creep && creep.name != name && creep.data !== undefined && creep.data.spawningTime !== undefined && creep.ticksToLive > (creep.data.spawningTime + (routeRange(creep.data.homeRoom, flag.pos.roomName)*25) ) ) {
                running.push(o);
            }
        };
        memory.running.forEach(validateRunning);
        memory.running = running;
    }
};
// get task memory
mod.memory = (flag) => {
    if( !flag.memory.tasks ) 
        flag.memory.tasks = {};
    if( !flag.memory.tasks.labTech ) {
        flag.memory.tasks.labTech = {
            queued: [], 
            spawning: [],
            running: []
        };
    }
    return flag.memory.tasks.labTech;
};
mod.nextAction = function(creep){
    if( creep.pos.roomName != creep.data.homeRoom && Game.rooms[creep.data.homeRoom] && Game.rooms[creep.data.homeRoom].controller ) {
        Creep.action.travelling.assignRoom(creep, creep.data.homeRoom);
        return;
    }
    let priority;
    if( creep.sum < creep.carryCapacity/2 ) {
        priority = [
            Creep.action.reallocating,
            Creep.action.uncharging,
            Creep.action.picking,
            Creep.action.withdrawing,
            Creep.action.idle];
    }
    else {
        priority = [
            Creep.action.reallocating,
            Creep.action.feeding,
            Creep.action.charging,
            Creep.action.fueling];
        if (creep.data.lastAction !== 'withdrawing' || !creep.room.storage || creep.data.lastTarget !== creep.room.storage.id) {
            priority.push(Creep.action.storing);           
        }
        priority.push(Creep.action.idle);
        if ( creep.sum > creep.carry.energy ||
            ( !creep.room.situation.invasion &&
                SPAWN_DEFENSE_ON_ATTACK && creep.room.conserveForDefense && creep.room.relativeEnergyAvailable > 0.8)) {
            priority.unshift(Creep.action.storing);
        }
        if (creep.room.structures.urgentRepairable.length > 0 ) {
            priority.unshift(Creep.action.fueling);
        }
    }

    for(var iAction = 0; iAction < priority.length; iAction++) {
        var a = priority[iAction];
        if(a.isValidAction(creep) && a.isAddableAction(creep) && a.assign(creep)) {
            if (a.name !== 'idle') {
                creep.data.lastAction = a.name;
                creep.data.lastTarget = creep.target.id;
            }
            return;
        }
    }
};

mod.creep = {
    labTech: {
        fixedBody: [WORK, CARRY, MOVE],
        multiBody: [CARRY, CARRY, MOVE],
        name: "labTech", 
        behaviour: "hauler", 
        queue: 'Low'
    },
};
