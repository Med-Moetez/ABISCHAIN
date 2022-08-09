var nj = require("numjs");
const randy = require("randy");
const prompt = require("prompt-sync")({ sigint: true });

// const n_iterations = prompt("Number of iterations: ");
const target_error = prompt("Target error: ");
const n_particles = prompt("Number of particles: ");

const list_eliminator_ratio = prompt(
  "Ratio to accept the pruned blockchain value=[0..1]: "
);
const n_head_lists = prompt(
  "number of particles which represents the head of the list :"
);
const current_blockchain_size = prompt("current blockchain size : ");

const W = 0.5;
const c1 = 0.8;
const c2 = 0.9;

// particle class
class Particle {
  constructor() {
    this.position = nj.array([Math.random() * 50, Math.random() * 50]);
    this.pbest_position = this.position;
    this.pbest_value = Infinity;
    this.velocity = nj.array([0, 0]);
    this.size = Math.random() * 100;
  }
  //Etat actuelle d'une particule
  particleState = () => {
    console.log(
      "I am at ",
      JSON.stringify(this.position),
      " my pbest is ",
      JSON.stringify(this.pbest_position)
    );
  };
  //methode pour changer la position d'une particule
  move() {
    const newPosition = nj.array([
      this.position.get(0) + this.velocity.get(0),
      this.position.get(1) + this.velocity.get(1),
    ]);
    this.position = newPosition;
  }
}

//  Space Class
class Space {
  constructor(target, target_error, n_particles) {
    this.target = target;
    this.target_error = target_error;
    this.n_particles = n_particles;
    this.particles = [];
    this.gbest_value = 0;
    this.gbest_position = nj.array([Math.random() * 50, Math.random() * 50]);
  }

  //methode qui affiche toutes les particules
  displayParticles = () => {
    this.particles.map((particle) => {
      particle.particleState();
    });
  };

  // our optimization function
  fitness(particle) {
    return particle.position.get(0) + particle.position.get(1) + 1;
  }

  setPbest() {
    this.particles.map((particle) => {
      let fitness_cadidate = this.fitness(particle);
      if (particle.pbest_value < fitness_cadidate) {
        particle.pbest_value = fitness_cadidate;
        particle.pbest_position = particle.position;
      }
    });
  }
  setGbest() {
    this.particles.map((particle) => {
      let best_fitness_cadidate = this.fitness(particle);
      if (this.gbest_value < best_fitness_cadidate) {
        this.gbest_value = best_fitness_cadidate;
        this.gbest_position = particle.position;
      }
    });
  }

  moveParticles() {
    this.particles.map((particle) => {
      let new_velocity =
        W * particle.velocity.get(0) +
        c1 * Math.random() * (particle.pbest_position - particle.position) +
        Math.random() * c2 * (this.gbest_position - particle.position);
      particle.velocity = nj.array([new_velocity, new_velocity]);
      particle.move();
    });
  }
}
console.time("execution Time");
const search_space = new Space(Infinity, target_error, n_particles);
let currentParticles = [];
const main = () => {
  for (let i = 0; i < search_space.n_particles; i++) {
    currentParticles.push(new Particle());
  }
  const particles_vector = currentParticles;
  search_space.particles = particles_vector;
  search_space.displayParticles();

  let iteration = 0;
  let currentBestParticle = null;
  while (iteration < n_head_lists) {
    currentBestParticle = currentParticles.filter(
      (element) => element.pbest_position == search_space.gbest_position
    );
    search_space.setPbest();
    search_space.setGbest();

    if (
      Math.abs(search_space.gbest_value - search_space.target) <=
      search_space.target_error
    ) {
      break;
    }
    //evaluate prunning list in terms of size gain
    if (
      currentBestParticle.size / current_blockchain_size >
      list_eliminator_ratio
    ) {
      const newlist = currentParticles.filter(
        (element) => element.pbest_position != search_space.gbest_position
      );
      search_space.particles = newlist;
    }

    search_space.moveParticles();
    iteration += 1;
  }
};
main();

console.log(
  "The best solution is: ",
  JSON.stringify(search_space.gbest_position)
);
console.timeEnd("execution Time");

// const search_space = new Space(target, target_error, n_particles);

// target = inifity

// target_error = target error to break

// n_partiles = number of bots

// z best bot in the network

// z = x + y + c

// minimal value is 1 so c =1

// x = trustrate {value creation + reputation}

// y = number of bot connexions

//script to evaluate prunning list in terms of size gain

//so we will define a threshold of size gain else rejecting result
//and a threshold to get the head of the list and get their resulst one by one
